import { resolve } from "node:path";
import {
  CoordinateRangeError,
  DenoPermissionError,
  HistoryEvictedError,
  LaunchError,
  ProcessExitedError,
  ReservedEnvironmentError,
  SessionClosedError,
  StrictLocatorError,
} from "../errors.ts";
import {
  assertSupportedRuntime,
  normalizeViewport,
  profileEnvironment,
  resolveAssets,
} from "../profile.ts";
import { FrameKind } from "../pty/protocol.ts";
import { SidecarClient } from "../pty/client.ts";
import { SessionTrace } from "../tracing/trace.ts";
import type {
  ActionReceipt,
  AsyncLocator,
  AsyncRegion,
  AsyncTerminal,
  CellChange,
  KeyName,
  KeyPress,
  LocatorMatch,
  MouseOptions,
  Point,
  ProcessStatus,
  Rect,
  ScreenCell,
  ScreenReader,
  ScreenRevision,
  ScreenSnapshot,
  TerminalLaunchOptions,
  TextLocatorOptions,
  TraceableInputOptions,
  Viewport,
  WheelOptions,
} from "../types.ts";
import { GhosttyWasmTerminal } from "./wasm.ts";
function concatBytes(parts: readonly Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
function visualKey(s: ScreenSnapshot) {
  return JSON.stringify([
    s.lines.map((l) => l.cells.map((c) => [c.text, c.style])),
    s.cursor,
    s.activeBuffer,
    s.viewport,
  ]);
}
function observableKey(s: ScreenSnapshot) {
  return JSON.stringify([visualKey(s), s.modes, s.title, s.workingDirectory]);
}
export class TerminalSession implements AsyncTerminal {
  #host!: SidecarClient;
  #engine!: GhosttyWasmTerminal;
  #snapshot!: ScreenSnapshot;
  #status: ProcessStatus = { state: "starting", ptyEof: false };
  #closed = false;
  #action = 0;
  #revision = 0;
  #history: ScreenRevision[] = [];
  #historyDecodedBytes = 0;
  #historySizes: number[] = [];
  #raw: Uint8Array[] = [];
  #listeners = new Set<() => void>();
  #outputPump: Promise<void> = Promise.resolve();
  #commands: Promise<unknown> = Promise.resolve();
  #lastAction?: ActionReceipt;
  #mouseDown = false;
  #trace: SessionTrace;
  #viewport;
  #fatalError?: Error;
  #exitResolve!: (s: ProcessStatus) => void;
  #exitPromise: Promise<ProcessStatus>;
  private constructor(readonly options: TerminalLaunchOptions) {
    this.#viewport = normalizeViewport(options.viewport);
    const t =
        typeof options.trace === "string"
          ? options.trace
          : (options.trace?.policy ?? "retain-on-failure"),
      dir =
        typeof options.trace === "object"
          ? (options.trace.directory ?? ".ghostwright")
          : ".ghostwright";
    this.#trace = new SessionTrace(options, t, dir);
    this.#exitPromise = new Promise((r) => (this.#exitResolve = r));
  }
  static async launch(options: TerminalLaunchOptions) {
    assertSupportedRuntime();
    if (!options.command || options.command.includes("\0"))
      throw new TypeError("command must be a nonempty NUL-free string");
    for (const [label, value] of [
      ...(options.args ?? []).map((value, index) => [`argument ${index}`, value] as const),
      ...Object.entries(options.env ?? {}).flatMap(([key, value]) => [
        [`environment key ${key}`, key] as const,
        [`environment value ${key}`, value] as const,
      ]),
      ...(options.cwd ? [["cwd", options.cwd] as const] : []),
    ])
      if (value.includes("\0")) throw new TypeError(`${label} must not contain NUL`);
    for (const [label, value] of [
      ["commandTimeoutMs", options.commandTimeoutMs],
      ["assertionTimeoutMs", options.assertionTimeoutMs],
      ["settleMs", options.settleMs],
      ["hangupGraceMs", options.cleanup?.hangupGraceMs],
      ["terminateGraceMs", options.cleanup?.terminateGraceMs],
      ["postExitDrainMs", options.cleanup?.postExitDrainMs],
      ["maxRevisions", options.history?.maxRevisions],
      ["maxRawBytes", options.history?.maxRawBytes],
      ["maxDecodedBytes", options.history?.maxDecodedBytes],
    ] as const)
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
        throw new RangeError(`${label} must be a nonnegative safe integer`);
    const self = new TerminalSession(options),
      assets = await resolveAssets(options),
      cwd = resolve(options.cwd ?? process.cwd());
    let env: Record<string, string>;
    try {
      env = profileEnvironment(options.env, assets.terminfo);
    } catch (cause) {
      if ("Deno" in globalThis && !(cause instanceof ReservedEnvironmentError))
        throw new DenoPermissionError(
          `Deno cannot inherit the launch environment. Add --allow-env together with --allow-read=${assets.root} --allow-run=${assets.host}`,
          { cause },
        );
      throw cause;
    }
    self.#engine = await GhosttyWasmTerminal.create(self.#viewport);
    self.#snapshot = self.#engine.snapshot();
    self.#host = await SidecarClient.start(assets.host, options.commandTimeoutMs ?? 5000);
    self.#host.on("output", (b, seq) => {
      self.#outputPump = self.#outputPump
        .then(() => self.#output(b, seq))
        .catch((error) => {
          self.#status = { ...self.#status, state: "failed" };
          self.#trace.add("output-pump-error", {
            message: error instanceof Error ? error.message : String(error),
          });
          self.#notify();
          self.#exitResolve(self.#status);
        });
    });
    self.#host.on("exit", (x) => {
      self.#status = { ...self.#status, state: "exited", ...x };
      self.#trace.add("process-exit", x);
      self.#notify();
      if (self.#status.ptyEof) self.#exitResolve(self.#status);
    });
    self.#host.on("eof", () => {
      void self.#outputPump.then(() => {
        self.#status = { ...self.#status, ptyEof: true };
        self.#trace.add("pty-eof");
        self.#notify();
        if (self.#status.state === "exited") self.#exitResolve(self.#status);
      });
    });
    self.#host.on("fatal", (e) => {
      self.#fatalError = e;
      self.#status = { ...self.#status, state: "failed" };
      self.#trace.add("sidecar-error", { message: e.message });
      self.#notify();
      self.#exitResolve(self.#status);
    });
    let spawned: any;
    try {
      spawned = await self.#host.spawn({
        command: options.command,
        args: options.args ?? [],
        cwd,
        env,
        viewport: self.#viewport,
        cleanup: {
          hangupGraceMs: options.cleanup?.hangupGraceMs ?? 500,
          terminateGraceMs: options.cleanup?.terminateGraceMs ?? 500,
          postExitDrainMs: options.cleanup?.postExitDrainMs ?? 1_000,
        },
      });
    } catch (cause) {
      self.#host.forceKill();
      self.#engine.free();
      throw new LaunchError(
        `Unable to launch ${JSON.stringify(options.command)} in ${JSON.stringify(cwd)}`,
        { cause },
      );
    }
    if (self.#fatalError) {
      self.#engine.free();
      throw new LaunchError(
        `Unable to launch ${JSON.stringify(options.command)} in ${JSON.stringify(cwd)}: ${self.#fatalError.message}`,
        { cause: self.#fatalError },
      );
    }
    self.#status = {
      state: "running",
      pid: spawned.pid,
      processGroupId: spawned.processGroupId,
      ptyEof: false,
    };
    self.#trace.add("spawned", { pid: spawned.pid, processGroupId: spawned.processGroupId });
    return self;
  }
  get trace() {
    return this.#trace;
  }
  get history() {
    return this.#history;
  }
  get lastAction() {
    return this.#lastAction;
  }
  now() {
    return this.#engine.now();
  }
  #notify() {
    for (const f of [...this.#listeners]) f();
  }
  subscribe(f: () => void) {
    this.#listeners.add(f);
    return () => this.#listeners.delete(f);
  }
  async #output(bytes: Uint8Array, sourceFrameSequence: number) {
    if (this.#closed) return;
    this.#trace.output(bytes, sourceFrameSequence);
    this.#raw.push(bytes.slice());
    const max = this.options.history?.maxRawBytes ?? 4 * 1024 * 1024;
    while (this.#raw.reduce((n, b) => n + b.length, 0) > max) this.#raw.shift();
    this.#engine.write(bytes);
    this.#publish("pty-output", sourceFrameSequence);
    for (const effect of this.#engine.takeEffects()) {
      this.#trace.add("terminal-effect", {
        effect: effect.type,
        ...(effect.type === "write-pty" ? { bytes: effect.data.length } : {}),
      });
      if (effect.type === "write-pty") {
        this.#trace.input(effect.data, 0, false);
        await this.#command(() => this.#host.write(effect.data));
      }
    }
  }
  #command<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#commands.then(operation);
    this.#commands = result;
    return result;
  }
  #publish(cause: "pty-output" | "resize" | "reset", sourceFrameSequence?: number) {
    const decoded = this.#engine.snapshot(cause),
      lines = decoded.lines.map((line, index) =>
        JSON.stringify(line) === JSON.stringify(this.#snapshot.lines[index])
          ? this.#snapshot.lines[index]
          : line,
      ),
      next = Object.freeze({ ...decoded, lines: Object.freeze(lines) }),
      changed = observableKey(next) !== observableKey(this.#snapshot);
    if (!changed) return;
    const visual = visualKey(next) !== visualKey(this.#snapshot),
      changedRows: number[] = [];
    for (let i = 0; i < next.lines.length; i++)
      if (next.lines[i] !== this.#snapshot.lines[i]) changedRows.push(i);
    this.#revision++;
    this.#snapshot = Object.freeze({
      ...next,
      sequence: this.#revision,
      lastVisualChangeAt: visual ? next.timestamp : this.#snapshot.lastVisualChangeAt,
    });
    const rev = Object.freeze({
      sequence: this.#revision,
      timestamp: next.timestamp,
      cause,
      sourceFrameSequence,
      changedRows: Object.freeze(changedRows),
      visualChange: visual,
      snapshot: this.#snapshot,
    });
    this.#history.push(rev);
    const decodedSize = changedRows.reduce(
      (total, row) => total + JSON.stringify(this.#snapshot.lines[row]).length * 2,
      512,
    );
    this.#historySizes.push(decodedSize);
    this.#historyDecodedBytes += decodedSize;
    const max = this.options.history?.maxRevisions ?? 1000,
      maxDecoded = this.options.history?.maxDecodedBytes ?? 64 * 1024 * 1024;
    while (this.#history.length > max || this.#historyDecodedBytes > maxDecoded) {
      this.#history.shift();
      this.#historyDecodedBytes -= this.#historySizes.shift() ?? 0;
    }
    this.#trace.add("revision", {
      revision: this.#revision,
      cause,
      changedRows,
      visualChange: visual,
    });
    this.#notify();
  }
  #ensure(op: string) {
    if (this.#closed) throw new SessionClosedError(`Cannot ${op}: terminal session is closed`);
  }
  async #send(kind: FrameKind, value: unknown, raw = false, delivered = true) {
    this.#ensure("perform action");
    const before = this.#revision,
      sequence = ++this.#action;
    let ack: any;
    if (kind === FrameKind.WRITE)
      ack = await this.#command(() => this.#host.write(value as Uint8Array));
    else if (kind === FrameKind.RESIZE) ack = await this.#command(() => this.#host.resize(value));
    else if (kind === FrameKind.SIGNAL) ack = await this.#command(() => this.#host.signal(value));
    else throw new Error("Unsupported action");
    const receipt: Object = Object.freeze({
      actionSequence: sequence,
      screenSequenceBefore: before,
      acknowledgedAt: this.#engine.now(),
      deliveredToChild: delivered,
      bytesWritten: ack.bytesWritten ?? 0,
    });
    this.#lastAction = receipt as ActionReceipt;
    this.#trace.add("action", {
      actionSequence: sequence,
      kind,
      bytesWritten: ack.bytesWritten ?? 0,
      ...(kind === FrameKind.RESIZE ? { viewport: value } : {}),
    });
    return receipt as ActionReceipt;
  }
  async #write(
    data: Uint8Array,
    delivered = data.length > 0,
    traceMode: "record" | "redact" = "record",
  ) {
    this.#ensure("write input");
    const before = this.#revision,
      sequence = ++this.#action;
    let total = 0;
    this.#trace.input(data, sequence, traceMode === "redact");
    for (let offset = 0; offset < data.length; offset += 65_536) {
      const chunk = data.slice(offset, offset + 65_536);
      const ack = await this.#command(() => this.#host.write(chunk));
      total += ack.bytesWritten ?? 0;
    }
    const receipt = Object.freeze({
      actionSequence: sequence,
      screenSequenceBefore: before,
      acknowledgedAt: this.#engine.now(),
      deliveredToChild: delivered,
      bytesWritten: total,
    });
    this.#lastAction = receipt;
    this.#trace.add("action", {
      actionSequence: sequence,
      kind: FrameKind.WRITE,
      bytesWritten: total,
    });
    return receipt;
  }
  keyboard = {
    press: async (key: KeyName | KeyPress) => this.#write(this.#engine.encodeKey(key)),
    type: async (text: string, options?: TraceableInputOptions) =>
      this.#write(
        concatBytes(Array.from(text, (key) => this.#engine.encodeKey(key))),
        true,
        options?.trace ?? "record",
      ),
    paste: async (text: string, options?: TraceableInputOptions) =>
      this.#write(this.#engine.encodePaste(text), true, options?.trace ?? "record"),
    focus: async (state: "in" | "out") => {
      const b = this.#engine.encodeFocus(state);
      return this.#write(b);
    },
    write: async (data: Uint8Array) => this.#write(data),
  };
  #point(p: Point) {
    if (
      !Number.isInteger(p.column) ||
      !Number.isInteger(p.row) ||
      p.column < 0 ||
      p.row < 0 ||
      p.column >= this.#viewport.columns ||
      p.row >= this.#viewport.rows
    )
      throw new CoordinateRangeError(
        `Coordinate (${p.column},${p.row}) is outside ${this.#viewport.columns}x${this.#viewport.rows}`,
      );
  }
  #mouse(action: "move" | "down" | "up", p: Point, o: MouseOptions = {}) {
    this.#point(p);
    const wasDown = this.#mouseDown;
    if (action === "down") this.#mouseDown = true;
    if (action === "up") this.#mouseDown = false;
    const bytes = this.#engine.encodeMouse(
      action,
      p,
      o,
      action === "up" ? wasDown : this.#mouseDown,
    );
    return this.#write(bytes, bytes.length > 0);
  }
  mouse = {
    move: (p: Point, o?: MouseOptions) => this.#mouse("move", p, o),
    down: (p: Point, o?: MouseOptions) => this.#mouse("down", p, o),
    up: (p: Point, o?: MouseOptions) => this.#mouse("up", p, o),
    click: async (p: Point, o?: MouseOptions) => {
      await this.#mouse("down", p, o);
      return this.#mouse("up", p, o);
    },
    doubleClick: async (p: Point, o?: MouseOptions) => {
      await this.mouse.click(p, o);
      return this.mouse.click(p, o);
    },
    drag: async (a: Point, b: Point, o?: MouseOptions) => {
      await this.#mouse("down", a, o);
      await this.#mouse("move", b, o);
      return this.#mouse("up", b, o);
    },
    wheel: (o: WheelOptions) => {
      this.#point(o);
      if (!Number.isInteger(o.deltaRows) || !Number.isInteger(o.deltaColumns ?? 0))
        throw new RangeError("Wheel deltas must be integers");
      const parts: Uint8Array[] = [];
      for (let index = 0; index < Math.abs(o.deltaRows); index++)
        parts.push(this.#engine.encodeMouse("down", o, { button: o.deltaRows < 0 ? 4 : 5 }, false));
      for (let index = 0; index < Math.abs(o.deltaColumns ?? 0); index++)
        parts.push(
          this.#engine.encodeMouse("down", o, { button: (o.deltaColumns ?? 0) < 0 ? 6 : 7 }, false),
        );
      const bytes = concatBytes(parts);
      return this.#write(bytes, bytes.length > 0);
    },
  };
  process = {
    status: () => ({ ...this.#status }),
    signal: (signal: string, target: "child" | "process-group" = "process-group") =>
      this.#send(FrameKind.SIGNAL, { signal, target }),
    waitForExit: async (options?: { timeoutMs?: number }) =>
      this.#timeout(
        this.#exitPromise,
        options?.timeoutMs ?? this.options.assertionTimeoutMs ?? 5000,
        () => new ProcessExitedError("Timed out waiting for process exit"),
      ),
  };
  getByText(text: string, options?: TextLocatorOptions) {
    return new Locator(this, text, options);
  }
  region(rect: Rect): AsyncRegion {
    this.#rect(rect);
    return {
      getByText: (text, options) => new Locator(this, text, options, undefined, rect),
      snapshot: () => this.#snapshot,
    };
  }
  validateRegion(r: Rect) {
    this.#rect(r);
  }
  #rect(r: Rect) {
    if (!Number.isInteger(r.width) || !Number.isInteger(r.height) || r.width <= 0 || r.height <= 0)
      this.#point({ column: -1, row: -1 });
    this.#point(r);
    this.#point({ column: r.column + r.width - 1, row: r.row + r.height - 1 });
  }
  async resize(v: Viewport) {
    const viewport = normalizeViewport(v);
    const receipt = await this.#send(FrameKind.RESIZE, viewport);
    this.#viewport = viewport;
    this.#engine.resize(viewport);
    this.#publish("resize");
    return receipt;
  }
  async close() {
    if (this.#closed)
      return Object.freeze({
        actionSequence: ++this.#action,
        screenSequenceBefore: this.#revision,
        acknowledgedAt: this.#engine.now(),
        deliveredToChild: false,
        bytesWritten: 0,
      });
    const before = this.#revision,
      sequence = ++this.#action;
    try {
      const c = this.options.cleanup ?? {},
        timeout = Math.max(
          this.options.commandTimeoutMs ?? 5000,
          (c.hangupGraceMs ?? 500) +
            (c.terminateGraceMs ?? 500) +
            (c.postExitDrainMs ?? 1000) +
            1000,
        );
      await this.#outputPump;
      await this.#commands;
      await this.#host.close(timeout);
      const receipt = Object.freeze({
        actionSequence: sequence,
        screenSequenceBefore: before,
        acknowledgedAt: this.#engine.now(),
        deliveredToChild: true,
        bytesWritten: 0,
      });
      this.#lastAction = receipt;
      this.#trace.add("action", { actionSequence: sequence, kind: FrameKind.CLOSE });
      return receipt;
    } finally {
      this.#closed = true;
      this.#status = { ...this.#status, state: "closed" };
      this.#engine.free();
      this.#trace.add("cleanup");
      this.#notify();
    }
  }
  async waitForChange(test: () => boolean, timeout: number) {
    if (test()) return;
    await new Promise<void>((resolve, reject) => {
      const off = this.subscribe(() => {
          if (test()) {
            clearTimeout(timer);
            off();
            resolve();
          } else if (this.#status.state === "closed" || this.#status.state === "failed") {
            clearTimeout(timer);
            off();
            reject(new SessionClosedError("Session closed before condition matched"));
          } else if (this.#status.ptyEof) {
            clearTimeout(timer);
            off();
            reject(new ProcessExitedError("Process exited before condition matched"));
          }
        }),
        timer = setTimeout(() => {
          off();
          reject(new Error("timeout"));
        }, timeout);
    });
  }
  async #timeout<T>(p: Promise<T>, ms: number, error: () => Error) {
    return new Promise<T>((r, j) => {
      const t = setTimeout(() => j(error()), ms);
      p.then(
        (x) => {
          clearTimeout(t);
          r(x);
        },
        (e) => {
          clearTimeout(t);
          j(e);
        },
      );
    });
  }
  revisionsSince(sequence: number) {
    const earliest = this.#history[0]?.sequence ?? this.#revision;
    if (sequence < earliest - 1)
      throw new HistoryEvictedError(
        `Revision ${sequence} was evicted; earliest retained is ${earliest}`,
      );
    return this.#history.filter((r) => r.sequence >= sequence);
  }
  screen: ScreenReader = {
    current: () => this.#snapshot,
    getCell: (p: Point) => {
      this.#point(p);
      return this.#snapshot.lines[p.row].cells[p.column];
    },
    getText: (r?: Rect) => {
      if (!r) return this.#snapshot.lines.map((l) => l.text).join("\n");
      this.#rect(r);
      return this.#snapshot.lines
        .slice(r.row, r.row + r.height)
        .map((l) =>
          l.cells
            .slice(r.column, r.column + r.width)
            .map((c) => (c.continuation ? "" : c.style.invisible ? " " : c.text || " "))
            .join(""),
        )
        .join("\n");
    },
    changedCells: (since: ScreenSnapshot | number) => {
      const seq = typeof since === "number" ? since : since.sequence,
        old =
          typeof since === "number"
            ? this.#history.find((r) => r.sequence === seq)?.snapshot
            : since;
      if (!old) throw new HistoryEvictedError(`Snapshot ${seq} is no longer retained`);
      const out: CellChange[] = [];
      for (let r = 0; r < this.#snapshot.lines.length; r++)
        for (let c = 0; c < this.#snapshot.lines[r].cells.length; c++) {
          const a = old.lines[r]?.cells[c],
            b = this.#snapshot.lines[r].cells[c];
          if (a && JSON.stringify(a) !== JSON.stringify(b))
            out.push({ point: { column: c, row: r }, before: a, after: b });
        }
      return out;
    },
    rawOutput: () => {
      const n = this.#raw.reduce((s, b) => s + b.length, 0),
        out = new Uint8Array(n);
      let p = 0;
      for (const b of this.#raw) {
        out.set(b, p);
        p += b.length;
      }
      return out;
    },
    scrollback: () => [],
    clipboard: () => this.#engine.clipboard(),
  };
}
export class Locator implements AsyncLocator {
  constructor(
    readonly session: TerminalSession,
    readonly query: string,
    readonly options: TextLocatorOptions = {},
    readonly index?: number,
    readonly bounds?: Rect,
  ) {}
  nth(index: number) {
    if (!Number.isInteger(index) || index < 0)
      throw new RangeError("nth index must be nonnegative");
    return new Locator(this.session, this.query, this.options, index, this.bounds);
  }
  region(rect: Rect) {
    this.session.validateRegion(rect);
    return new Locator(this.session, this.query, this.options, this.index, rect);
  }
  matches() {
    const s = this.session.screen.current(),
      out: LocatorMatch[] = [];
    for (const line of s.lines) {
      if (
        this.bounds &&
        (line.row < this.bounds.row || line.row >= this.bounds.row + this.bounds.height)
      )
        continue;
      const start = this.bounds?.column ?? 0,
        end = this.bounds ? this.bounds.column + this.bounds.width : s.viewport.columns,
        segments: Array<{ start: number; end: number; cell: ScreenCell }> = [];
      let row = "";
      for (const cell of line.cells.slice(start, end)) {
        if (cell.continuation) continue;
        const text = cell.style.invisible ? " " : cell.text || " ",
          offset = row.length;
        row += text;
        segments.push({ start: offset, end: row.length, cell });
      }
      const rangeFor = (from: number, to: number): Rect => {
        const first = segments.find((segment) => from < segment.end) ?? segments.at(-1),
          last = [...segments].reverse().find((segment) => to > segment.start) ?? first,
          column = first?.cell.column ?? start,
          lastEnd = last ? last.cell.column + Math.max(1, last.cell.width) : column + 1;
        return { column, row: line.row, width: Math.max(1, lastEnd - column), height: 1 };
      };
      if (this.options.exact) {
        const trimmed = row.replace(/ +$/g, "");
        if (trimmed === this.query)
          out.push({
            text: trimmed,
            rowText: row,
            range: rangeFor(0, trimmed.length),
          });
      } else {
        let at = 0;
        while (this.query.length && (at = row.indexOf(this.query, at)) >= 0) {
          out.push({
            text: this.query,
            rowText: row,
            range: rangeFor(at, at + this.query.length),
          });
          at += Math.max(1, this.query.length);
        }
      }
    }
    const chosen = this.index === undefined ? out : out[this.index] ? [out[this.index]] : [];
    return Object.freeze(chosen);
  }
  async unique(timeout = this.session.options.assertionTimeoutMs ?? 5000) {
    const get = () => this.matches();
    let m = get();
    if (m.length > 1)
      throw new StrictLocatorError(
        `Locator ${JSON.stringify(this.query)} matched ${m.length} ranges: ${m.map((x) => JSON.stringify(x.range)).join(", ")}`,
      );
    if (!m.length) {
      await this.session.waitForChange(() => {
        m = get();
        if (m.length > 1)
          throw new StrictLocatorError(
            `Locator ${JSON.stringify(this.query)} matched multiple ranges`,
          );
        return m.length === 1;
      }, timeout);
    }
    return m[0];
  }
  async click(options?: MouseOptions) {
    const m = await this.unique(),
      p = {
        column: Math.floor((m.range.column + m.range.column + m.range.width - 1) / 2),
        row: Math.floor((m.range.row + m.range.row + m.range.height - 1) / 2),
      };
    return this.session.mouse.click(p, options);
  }
}

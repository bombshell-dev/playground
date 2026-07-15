import { StrictLocatorError, TerminalAssertionError } from "../errors.ts";
import type { AsyncLocatorExpectation, AsyncTerminalExpectation } from "./types-internal.ts";
import type {
  AssertionOptions,
  ScreenRevision,
  StableAssertionOptions,
  TransientAssertionOptions,
} from "../types.ts";
import { Locator, TerminalSession } from "../terminal/session.ts";
function diagnostic(session: TerminalSession, expected: string, timeout: number, settle?: number) {
  const s = session.screen.current(),
    tens = Array.from({ length: s.viewport.columns }, (_, column) =>
      column % 10 === 0 ? String(Math.floor(column / 10) % 10) : " ",
    ).join(""),
    ones = Array.from({ length: s.viewport.columns }, (_, column) => String(column % 10)).join(""),
    rows = s.lines.map((line) => `${String(line.row).padStart(3)} |${line.text}|`).join("\n"),
    recent = session.trace
      .events()
      .filter((event) => event.type === "action")
      .slice(-5)
      .map((event) => `#${event.sequence} action=${event.actionSequence} kind=${event.kind}`)
      .join("; ");
  return `Ghostwright assertion failed\nexpected: ${expected}\ntimeout: ${timeout} ms${settle === undefined ? "" : `\nsettle: ${settle} ms`}\nviewport: ${s.viewport.columns}x${s.viewport.rows}\ncursor: (${s.cursor.column},${s.cursor.row}) visible=${s.cursor.visible} shape=${s.cursor.shape} blinking=${s.cursor.blinking}\nactive buffer: ${s.activeBuffer}\nmodes: ${JSON.stringify(s.modes)}\nprocess: ${JSON.stringify(session.process.status())}\nchanged rows: ${session.history.at(-1)?.changedRows.join(",") ?? "none"}\nhistory: earliest=${session.history.at(0)?.sequence ?? s.sequence} latest=${session.history.at(-1)?.sequence ?? s.sequence}\nrecent actions: ${recent || "none"}\nclosest candidates: ${
    s.lines
      .map((line) => line.text.trimEnd())
      .filter(Boolean)
      .slice(0, 5)
      .map((line) => JSON.stringify(line))
      .join(", ") || "none"
  }\n\n    ${tens}\n    ${ones}\n${rows}`;
}
async function wait(
  session: TerminalSession,
  test: () => boolean,
  timeout: number,
  message: () => string,
) {
  try {
    await session.waitForChange(test, timeout);
  } catch (cause) {
    if (cause instanceof StrictLocatorError) throw cause;
    throw new TerminalAssertionError(message(), { cause });
  }
}
class LocatorExpectation implements AsyncLocatorExpectation {
  constructor(readonly locator: Locator) {}
  async toBePresent(options: AssertionOptions = {}) {
    const timeout = options.timeoutMs ?? this.locator.session.options.assertionTimeoutMs ?? 5000;
    try {
      return await this.locator.unique(timeout);
    } catch (cause) {
      if (cause instanceof StrictLocatorError) throw cause;
      throw new TerminalAssertionError(
        diagnostic(
          this.locator.session,
          `${JSON.stringify(this.locator.query)} to be present`,
          timeout,
        ),
        { cause },
      );
    }
  }
  async toBeStable(options: StableAssertionOptions = {}) {
    const timeout = options.timeoutMs ?? this.locator.session.options.assertionTimeoutMs ?? 5000,
      settle = options.settleMs ?? this.locator.session.options.settleMs ?? 100,
      start = performance.now();
    let match = await this.toBePresent({ timeoutMs: timeout });
    for (;;) {
      const age =
          this.locator.session.now() - this.locator.session.screen.current().lastVisualChangeAt,
        remaining = Math.max(0, settle - age);
      if (!remaining) return match;
      if (performance.now() - start + remaining > timeout)
        throw new TerminalAssertionError(
          diagnostic(
            this.locator.session,
            `${JSON.stringify(this.locator.query)} to be visually stable`,
            timeout,
            settle,
          ),
        );
      await new Promise<void>((resolve) => {
        const off = this.locator.session.subscribe(() => {
            off();
            clearTimeout(timer);
            resolve();
          }),
          timer = setTimeout(() => {
            off();
            resolve();
          }, remaining);
      });
      const m = this.locator.matches();
      if (m.length > 1)
        throw new StrictLocatorError(
          `Locator ${JSON.stringify(this.locator.query)} matched ${m.length} ranges`,
        );
      if (m.length === 1) match = m[0];
      else
        match = await this.toBePresent({
          timeoutMs: Math.max(1, timeout - (performance.now() - start)),
        });
    }
  }
  async toBeAbsent(options: StableAssertionOptions = {}) {
    const timeout = options.timeoutMs ?? this.locator.session.options.assertionTimeoutMs ?? 5000,
      settle = options.settleMs ?? this.locator.session.options.settleMs ?? 100,
      start = performance.now();
    for (;;) {
      if (this.locator.matches().length === 0) {
        const snapshot = this.locator.session.screen.current(),
          age = this.locator.session.now() - snapshot.lastVisualChangeAt,
          remaining = Math.max(0, settle - age);
        if (remaining === 0) return;
        await new Promise<void>((resolve) => {
          const off = this.locator.session.subscribe(() => {
              off();
              clearTimeout(timer);
              resolve();
            }),
            timer = setTimeout(() => {
              off();
              resolve();
            }, remaining);
        });
        if (
          this.locator.matches().length === 0 &&
          this.locator.session.now() - this.locator.session.screen.current().lastVisualChangeAt >=
            settle
        )
          return;
      }
      if (performance.now() - start >= timeout)
        throw new TerminalAssertionError(
          diagnostic(
            this.locator.session,
            `${JSON.stringify(this.locator.query)} to be absent`,
            timeout,
            settle,
          ),
        );
      await wait(
        this.locator.session,
        () => this.locator.matches().length === 0,
        Math.max(1, timeout - (performance.now() - start)),
        () =>
          diagnostic(
            this.locator.session,
            `${JSON.stringify(this.locator.query)} to be absent`,
            timeout,
            settle,
          ),
      );
    }
  }
}
class TerminalExpectation implements AsyncTerminalExpectation {
  constructor(readonly session: TerminalSession) {}
  async toHaveShownText(text: string, options: TransientAssertionOptions = {}) {
    const timeout = options.timeoutMs ?? this.session.options.assertionTimeoutMs ?? 5000,
      baseline =
        typeof options.since === "number"
          ? options.since
          : (options.since?.screenSequenceBefore ??
            this.session.lastAction?.screenSequenceBefore ??
            this.session.screen.current().sequence);
    const find = () =>
      this.session
        .revisionsSince(baseline)
        .find((r) => r.snapshot.lines.some((l) => l.text.includes(text)));
    let result = find();
    if (!result) {
      await wait(
        this.session,
        () => !!(result = find()),
        timeout,
        () =>
          diagnostic(
            this.session,
            `${JSON.stringify(text)} to have been shown since revision ${baseline}`,
            timeout,
          ),
      );
    }
    return result as ScreenRevision;
  }
}
export function expectTerminal(
  target: Locator | TerminalSession,
): LocatorExpectation | TerminalExpectation {
  return target instanceof Locator
    ? new LocatorExpectation(target)
    : new TerminalExpectation(target);
}

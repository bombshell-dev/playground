import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  CellStyle,
  KittyGraphicsSnapshot,
  KittyImageSnapshot,
  KittyPlacementSnapshot,
  ScreenCell,
  ScreenLine,
  ScreenSnapshot,
  TerminalModes,
  Viewport,
  KeyName,
  KeyPress,
  MouseOptions,
  Point,
} from "../types.ts";
import { AssetIntegrityError } from "../errors.ts";

type Fn = (...args: any[]) => number;
type Exports = Record<string, Fn> & {
  memory: WebAssembly.Memory;
  __indirect_function_table: WebAssembly.Table;
};
type LayoutMap = Record<
  string,
  {
    size: number;
    fields: Record<string, { offset: number; size: number; type: string }>;
  }
>;
const encoder = new TextEncoder(),
  decoder = new TextDecoder();

function unsignedLeb(value: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return bytes;
}
function callbackModule(parameterCount: number, returnsInt = false): WebAssembly.Module {
  const section = (id: number, payload: number[]) => [
      id,
      ...unsignedLeb(payload.length),
      ...payload,
    ],
    name = (value: string) => {
      const bytes = [...encoder.encode(value)];
      return [...unsignedLeb(bytes.length), ...bytes];
    },
    type = [
      1,
      0x60,
      ...unsignedLeb(parameterCount),
      ...Array.from({ length: parameterCount }, () => 0x7f),
      returnsInt ? 1 : 0,
      ...(returnsInt ? [0x7f] : []),
    ],
    imported = [1, ...name("env"), ...name("callback"), 0, 0],
    exported = [1, ...name("callback"), 0, 0];
  return new WebAssembly.Module(
    Uint8Array.from([
      0x00,
      0x61,
      0x73,
      0x6d,
      0x01,
      0x00,
      0x00,
      0x00,
      ...section(1, type),
      ...section(2, imported),
      ...section(7, exported),
    ]),
  );
}

export type TerminalEffect =
  | { type: "write-pty"; data: Uint8Array }
  | { type: "bell" }
  | { type: "title" }
  | { type: "working-directory" }
  | { type: "clipboard-write"; data: string };
interface HistoryRow {
  line: ScreenLine;
  kittyVirtualPlaceholder: boolean;
}
const defaultStyle: CellStyle = Object.freeze({
  bold: false,
  italic: false,
  faint: false,
  blink: false,
  inverse: false,
  invisible: false,
  strikethrough: false,
  overline: false,
  underline: 0,
  foreground: Object.freeze({ kind: "default" as const }),
  background: Object.freeze({ kind: "default" as const }),
});
let compiled: Promise<WebAssembly.Module> | undefined;
async function moduleFor(url: URL) {
  return (compiled ??= WebAssembly.compile(await readFile(url)));
}
function freeze<T>(value: T): T {
  // Typed arrays are mutable buffers by design and cannot be frozen when nonempty.
  if (ArrayBuffer.isView(value)) return value;
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}
export class GhosttyWasmTerminal {
  #e!: Exports;
  #terminal = 0;
  #formatter = 0;
  #renderState = 0;
  #rowIterator = 0;
  #rowIteratorHolder = 0;
  #rowCells = 0;
  #rowCellsHolder = 0;
  #keyEncoder = 0;
  #keyEvent = 0;
  #mouseEncoder = 0;
  #mouseEvent = 0;
  #viewport: Required<Viewport>;
  #layouts!: LayoutMap;
  #allocations: Array<{ pointer: number; size: number }> = [];
  #opaqueAllocations: number[] = [];
  #callbackInstances: WebAssembly.Instance[] = [];
  #effects: TerminalEffect[] = [];
  #clipboard = "";
  #sequence = 0;
  #started = performance.now();
  #lastVisual = 0;
  #previous = "";
  #kittySupported = false;
  #kittyStorageLimit = 0;
  // Metadata is immutable and may be structurally shared by retained revisions.
  // Decoded pixel copies deliberately never enter this cache.
  #images = new Map<string, KittyImageSnapshot>();
  #currentImageKeys = new Set<string>();
  #inspectedImageIds = new Set<number>();
  private constructor(viewport: Required<Viewport>) {
    this.#viewport = viewport;
  }
  static async create(viewport: Required<Viewport>, storageLimitBytes = 64 * 1024 * 1024) {
    const self = new GhosttyWasmTerminal(viewport);
    const url = new URL(
      import.meta.url.includes("/dist/")
        ? "../artifacts/ghostty-vt.wasm"
        : "../../artifacts/ghostty-vt.wasm",
      import.meta.url,
    );
    let mod: WebAssembly.Module;
    try {
      mod = await moduleFor(url);
    } catch (cause) {
      throw new AssetIntegrityError(`Unable to load ${url.pathname}`, { cause });
    }
    const instance = await WebAssembly.instantiate(mod, { env: { log() {} } });
    self.#e = instance.exports as unknown as Exports;
    self.#initialize(storageLimitBytes);
    return self;
  }
  #view() {
    return new DataView(this.#e.memory.buffer);
  }
  #bytes() {
    return new Uint8Array(this.#e.memory.buffer);
  }
  #opaque() {
    const p = this.#e.ghostty_wasm_alloc_opaque();
    if (!p) throw new AssetIntegrityError("WASM allocation failed");
    this.#opaqueAllocations.push(p);
    return p;
  }
  #alloc(n: number) {
    const p = this.#e.ghostty_wasm_alloc_u8_array(n);
    if (!p) throw new AssetIntegrityError("WASM allocation failed");
    this.#allocations.push({ pointer: p, size: n });
    return p;
  }
  #release(pointer: number, size: number) {
    this.#e.ghostty_wasm_free_u8_array(pointer, size);
    const index = this.#allocations.findIndex((item) => item.pointer === pointer);
    if (index >= 0) this.#allocations.splice(index, 1);
  }
  #readTypeLayouts() {
    const pointer = this.#e.ghostty_type_json();
    const bytes = this.#bytes();
    let end = pointer;
    while (end < bytes.length && bytes[end] !== 0) end++;
    try {
      return JSON.parse(decoder.decode(bytes.subarray(pointer, end))) as LayoutMap;
    } catch (cause) {
      throw new AssetIntegrityError("Unable to decode libghostty-vt ABI metadata", { cause });
    }
  }
  #initialize(storageLimitBytes: number) {
    this.#layouts = this.#readTypeLayouts();
    const terminalLayout = this.#layouts.GhosttyTerminalOptions;
    if (!terminalLayout || terminalLayout.size !== 8)
      throw new AssetIntegrityError("Unexpected GhosttyTerminalOptions ABI layout");
    const out = this.#opaque(),
      opts = this.#alloc(terminalLayout.size),
      d = this.#view();
    d.setUint16(opts, this.#viewport.columns, true);
    d.setUint16(opts + 2, this.#viewport.rows, true);
    d.setUint32(opts + 4, 10000, true);
    if (this.#e.ghostty_terminal_new(0, out, opts) !== 0)
      throw new AssetIntegrityError("ghostty_terminal_new failed");
    this.#terminal = this.#view().getUint32(out, true);
    const capability = this.#alloc(1);
    try {
      this.#kittySupported =
        this.#e.ghostty_build_info(2, capability) === 0 && this.#view().getUint8(capability) !== 0;
    } finally {
      this.#release(capability, 1);
    }
    if (!this.#kittySupported)
      throw new AssetIntegrityError(
        "ghostty-vt.wasm was built without the required Kitty graphics capability",
      );
    {
      if (!Number.isSafeInteger(storageLimitBytes) || storageLimitBytes < 0)
        throw new RangeError("graphics.storageLimitBytes must be a nonnegative safe integer");
      const limit = this.#alloc(8);
      try {
        this.#view().setBigUint64(limit, BigInt(storageLimitBytes), true);
        if (this.#e.ghostty_terminal_set(this.#terminal, 15, limit) !== 0)
          throw new AssetIntegrityError("Unable to configure Kitty image storage limit");
        this.#kittyStorageLimit = storageLimitBytes;
      } finally {
        this.#release(limit, 8);
      }
    }
    if (
      this.#e.ghostty_terminal_resize(
        this.#terminal,
        this.#viewport.columns,
        this.#viewport.rows,
        10,
        20,
      ) !== 0
    )
      throw new AssetIntegrityError("Unable to initialize Ghostty cell pixel geometry");
    const fo = this.#opaque(),
      o = this.#alloc(40),
      v = this.#view();
    v.setUint32(o, 40, true);
    v.setUint32(o + 4, 0, true);
    v.setUint8(o + 8, 0);
    v.setUint8(o + 9, 0);
    v.setUint32(o + 12, 24, true);
    v.setUint32(o + 24, 12, true);
    if (this.#e.ghostty_formatter_terminal_new(0, fo, this.#terminal, o) !== 0)
      throw new AssetIntegrityError("ghostty_formatter_terminal_new failed");
    this.#formatter = this.#view().getUint32(fo, true);
    const renderStateOut = this.#opaque();
    if (this.#e.ghostty_render_state_new(0, renderStateOut) !== 0)
      throw new AssetIntegrityError("ghostty_render_state_new failed");
    this.#renderState = this.#view().getUint32(renderStateOut, true);
    this.#rowIteratorHolder = this.#opaque();
    if (this.#e.ghostty_render_state_row_iterator_new(0, this.#rowIteratorHolder) !== 0)
      throw new AssetIntegrityError("ghostty_render_state_row_iterator_new failed");
    this.#rowIterator = this.#view().getUint32(this.#rowIteratorHolder, true);
    this.#rowCellsHolder = this.#opaque();
    if (this.#e.ghostty_render_state_row_cells_new(0, this.#rowCellsHolder) !== 0)
      throw new AssetIntegrityError("ghostty_render_state_row_cells_new failed");
    this.#rowCells = this.#view().getUint32(this.#rowCellsHolder, true);

    const keyEncoderOut = this.#opaque();
    if (this.#e.ghostty_key_encoder_new(0, keyEncoderOut) !== 0)
      throw new AssetIntegrityError("ghostty_key_encoder_new failed");
    this.#keyEncoder = this.#view().getUint32(keyEncoderOut, true);
    const keyEventOut = this.#opaque();
    if (this.#e.ghostty_key_event_new(0, keyEventOut) !== 0)
      throw new AssetIntegrityError("ghostty_key_event_new failed");
    this.#keyEvent = this.#view().getUint32(keyEventOut, true);

    const mouseEncoderOut = this.#opaque();
    if (this.#e.ghostty_mouse_encoder_new(0, mouseEncoderOut) !== 0)
      throw new AssetIntegrityError("ghostty_mouse_encoder_new failed");
    this.#mouseEncoder = this.#view().getUint32(mouseEncoderOut, true);
    const mouseEventOut = this.#opaque();
    if (this.#e.ghostty_mouse_event_new(0, mouseEventOut) !== 0)
      throw new AssetIntegrityError("ghostty_mouse_event_new failed");
    this.#mouseEvent = this.#view().getUint32(mouseEventOut, true);
    this.#configureMouseSize();
    this.#configureEffects();
    this.#lastVisual = this.now();
  }
  now() {
    return performance.now() - this.#started;
  }
  write(data: Uint8Array) {
    if (!data.length) return;
    const p = this.#alloc(data.length);
    this.#bytes().set(data, p);
    this.#e.ghostty_terminal_vt_write(this.#terminal, p, data.length);
    this.#e.ghostty_wasm_free_u8_array(p, data.length);
  }
  resize(v: Required<Viewport>) {
    this.#viewport = v;
    if (this.#e.ghostty_terminal_resize(this.#terminal, v.columns, v.rows, 10, 20) !== 0)
      throw new Error("Ghostty resize failed");
    this.#configureMouseSize();
  }
  #installCallback(
    option: number,
    parameterCount: number,
    callback: (...args: number[]) => number | void,
    returnsInt = false,
  ) {
    const instance = new WebAssembly.Instance(callbackModule(parameterCount, returnsInt), {
        env: { callback },
      }),
      fn = instance.exports.callback as CallableFunction,
      table = this.#e.__indirect_function_table,
      index = table.length;
    table.grow(1);
    table.set(index, fn);
    this.#callbackInstances.push(instance);
    if (this.#e.ghostty_terminal_set(this.#terminal, option, index) !== 0)
      throw new AssetIntegrityError(`Unable to configure Ghostty terminal effect ${option}`);
  }
  #configureEffects() {
    this.#installCallback(1, 4, (_terminal, _userdata, data, length) => {
      this.#effects.push({ type: "write-pty", data: this.#bytes().slice(data, data + length) });
    });
    this.#installCallback(2, 2, () => this.#effects.push({ type: "bell" }));
    for (const [option, response] of [
      [3, "ghostwright"],
      [4, "ghostwright/0.1.0 libghostty-vt/f8041e849b36"],
    ] as const) {
      const bytes = encoder.encode(response),
        data = this.#alloc(bytes.length),
        stringLayout = this.#layouts.GhosttyString;
      this.#bytes().set(bytes, data);
      this.#installCallback(option, 3, (output) => {
        const view = this.#view();
        view.setUint32(output + stringLayout.fields.ptr.offset, data, true);
        view.setUint32(output + stringLayout.fields.len.offset, bytes.length, true);
      });
    }
    this.#installCallback(5, 2, () => this.#effects.push({ type: "title" }));
    this.#installCallback(25, 2, () => this.#effects.push({ type: "working-directory" }));
    this.#installCallback(
      6,
      3,
      (_terminal, _userdata, output) => {
        const layout = this.#layouts.GhosttySizeReportSize,
          field = (name: string) => layout.fields[name].offset,
          view = this.#view();
        view.setUint16(output + field("rows"), this.#viewport.rows, true);
        view.setUint16(output + field("columns"), this.#viewport.columns, true);
        view.setUint32(output + field("cell_width"), 10, true);
        view.setUint32(output + field("cell_height"), 20, true);
        return 1;
      },
      true,
    );
    this.#installCallback(
      7,
      3,
      (_terminal, _userdata, output) => {
        this.#view().setInt32(output, 1, true);
        return 1;
      },
      true,
    );
    this.#installCallback(
      8,
      3,
      (_terminal, _userdata, output) => {
        const all = this.#layouts.GhosttyDeviceAttributes,
          primary = this.#layouts.GhosttyDeviceAttributesPrimary,
          secondary = this.#layouts.GhosttyDeviceAttributesSecondary,
          tertiary = this.#layouts.GhosttyDeviceAttributesTertiary,
          p = output + all.fields.primary.offset,
          s = output + all.fields.secondary.offset,
          t = output + all.fields.tertiary.offset,
          view = this.#view();
        view.setUint16(p + primary.fields.conformance_level.offset, 62, true);
        view.setUint16(p + primary.fields.features.offset, 22, true);
        view.setUint32(p + primary.fields.num_features.offset, 1, true);
        view.setUint16(s + secondary.fields.device_type.offset, 1, true);
        view.setUint16(s + secondary.fields.firmware_version.offset, 0, true);
        view.setUint16(s + secondary.fields.rom_cartridge.offset, 0, true);
        view.setUint32(t + tertiary.fields.unit_id.offset, 0, true);
        return 1;
      },
      true,
    );
    this.#installCallback(
      26,
      3,
      (_terminal, _userdata, write) => {
        const writeLayout = this.#layouts.GhosttyClipboardWrite,
          contentLayout = this.#layouts.GhosttyClipboardContent,
          stringLayout = this.#layouts.GhosttyString,
          view = this.#view(),
          count = view.getUint32(write + writeLayout.fields.contents_len.offset, true),
          contents = view.getUint32(write + writeLayout.fields.contents.offset, true);
        this.#clipboard = "";
        if (count > 0 && contents) {
          const dataString = contents + contentLayout.fields.data.offset,
            pointer = view.getUint32(dataString + stringLayout.fields.ptr.offset, true),
            length = view.getUint32(dataString + stringLayout.fields.len.offset, true);
          this.#clipboard = decoder.decode(this.#bytes().subarray(pointer, pointer + length));
        }
        this.#effects.push({ type: "clipboard-write", data: this.#clipboard });
        return 0;
      },
      true,
    );
  }
  takeEffects() {
    return this.#effects.splice(0);
  }
  clipboard() {
    return this.#clipboard;
  }
  #configureMouseSize() {
    if (!this.#mouseEncoder) return;
    const layout = this.#layouts.GhosttyMouseEncoderSize;
    if (!layout) throw new AssetIntegrityError("Missing GhosttyMouseEncoderSize ABI metadata");
    const pointer = this.#alloc(layout.size),
      view = this.#view(),
      field = (name: string) => layout.fields[name].offset;
    view.setUint32(pointer + field("size"), layout.size, true);
    view.setUint32(pointer + field("screen_width"), this.#viewport.widthPixels, true);
    view.setUint32(pointer + field("screen_height"), this.#viewport.heightPixels, true);
    view.setUint32(pointer + field("cell_width"), 10, true);
    view.setUint32(pointer + field("cell_height"), 20, true);
    for (const name of ["padding_top", "padding_bottom", "padding_right", "padding_left"])
      view.setUint32(pointer + field(name), 0, true);
    this.#e.ghostty_mouse_encoder_setopt(this.#mouseEncoder, 2, pointer);
    this.#release(pointer, layout.size);
  }
  #get(kind: number, size = 4) {
    const p = this.#alloc(size);
    try {
      this.#e.ghostty_terminal_get(this.#terminal, kind, p);
      return size === 1
        ? this.#view().getUint8(p)
        : size === 2
          ? this.#view().getUint16(p, true)
          : this.#view().getUint32(p, true);
    } finally {
      this.#release(p, size);
    }
  }
  mode(n: number) {
    const p = this.#alloc(1);
    try {
      return (
        this.#e.ghostty_terminal_mode_get(this.#terminal, n, p) === 0 &&
        this.#view().getUint8(p) !== 0
      );
    } finally {
      this.#release(p, 1);
    }
  }
  text() {
    const lp = this.#alloc(4);
    let p = 0,
      n = 0;
    try {
      this.#e.ghostty_formatter_format_buf(this.#formatter, 0, 0, lp);
      n = this.#view().getUint32(lp, true);
      if (!n) return "";
      p = this.#alloc(n);
      if (this.#e.ghostty_formatter_format_buf(this.#formatter, p, n, lp) !== 0) return "";
      return decoder.decode(this.#bytes().slice(p, p + n));
    } finally {
      if (p) this.#release(p, n);
      this.#release(lp, 4);
    }
  }
  modes(): TerminalModes {
    const tracking = this.mode(1003)
      ? "any"
      : this.mode(1002)
        ? "button"
        : this.mode(1000)
          ? "normal"
          : this.mode(9)
            ? "x10"
            : "none";
    const format = this.mode(1016)
      ? "sgr-pixels"
      : this.mode(1006)
        ? "sgr"
        : this.mode(1015)
          ? "urxvt"
          : this.mode(1005)
            ? "utf8"
            : "x10";
    const privateModeNumbers = [
        1, 9, 25, 47, 66, 67, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 1016, 1047, 1049, 2004,
      ],
      privateModes = Object.freeze(
        Object.fromEntries(privateModeNumbers.map((mode) => [mode, this.mode(mode)])),
      );
    return {
      applicationCursorKeys: this.mode(1),
      backarrowSendsBackspace: this.mode(67),
      bracketedPaste: this.mode(2004),
      focusReporting: this.mode(1004),
      mouseTracking: tracking,
      mouseFormat: format,
      kittyKeyboardFlags: this.#get(8, 1),
      alternateScreen: this.#get(6) === 1,
      privateModes,
    };
  }
  #renderGet(kind: number, size = 4) {
    const pointer = this.#alloc(size);
    try {
      if (this.#e.ghostty_render_state_get(this.#renderState, kind, pointer) !== 0) return 0;
      return size === 1
        ? this.#view().getUint8(pointer)
        : size === 2
          ? this.#view().getUint16(pointer, true)
          : this.#view().getUint32(pointer, true);
    } finally {
      this.#release(pointer, size);
    }
  }
  #styleFromPointer(stylePointer: number): CellStyle {
    const styleLayout = this.#layouts.GhosttyStyle,
      view = this.#view();
    return Object.freeze({
      bold: view.getUint8(stylePointer + styleLayout.fields.bold.offset) !== 0,
      italic: view.getUint8(stylePointer + styleLayout.fields.italic.offset) !== 0,
      faint: view.getUint8(stylePointer + styleLayout.fields.faint.offset) !== 0,
      blink: view.getUint8(stylePointer + styleLayout.fields.blink.offset) !== 0,
      inverse: view.getUint8(stylePointer + styleLayout.fields.inverse.offset) !== 0,
      invisible: view.getUint8(stylePointer + styleLayout.fields.invisible.offset) !== 0,
      strikethrough: view.getUint8(stylePointer + styleLayout.fields.strikethrough.offset) !== 0,
      overline: view.getUint8(stylePointer + styleLayout.fields.overline.offset) !== 0,
      underline: view.getInt32(stylePointer + styleLayout.fields.underline.offset, true),
      foreground: this.#color(stylePointer, "fg_color"),
      background: this.#color(stylePointer, "bg_color"),
      underlineColor: this.#color(stylePointer, "underline_color"),
    });
  }
  #terminalString(kind: number) {
    const layout = this.#layouts.GhosttyString,
      pointer = this.#alloc(layout.size);
    try {
      if (this.#e.ghostty_terminal_get(this.#terminal, kind, pointer) !== 0) return "";
      const view = this.#view(),
        data = view.getUint32(pointer + layout.fields.ptr.offset, true),
        length = view.getUint32(pointer + layout.fields.len.offset, true);
      return length ? decoder.decode(this.#bytes().subarray(data, data + length)) : "";
    } finally {
      this.#release(pointer, layout.size);
    }
  }
  #color(stylePointer: number, fieldName: "fg_color" | "bg_color" | "underline_color") {
    const style = this.#layouts.GhosttyStyle,
      color = this.#layouts.GhosttyStyleColor,
      base = stylePointer + style.fields[fieldName].offset,
      tag = this.#view().getInt32(base + color.fields.tag.offset, true),
      value = base + color.fields.value.offset;
    if (tag === 1) return { kind: "palette" as const, index: this.#view().getUint8(value) };
    if (tag === 2)
      return {
        kind: "rgb" as const,
        red: this.#view().getUint8(value),
        green: this.#view().getUint8(value + 1),
        blue: this.#view().getUint8(value + 2),
      };
    return { kind: "default" as const };
  }
  scrollbackRows() {
    return this.#get(15);
  }
  /** Copies a bounded oldest-based scrollback range without moving Ghostty's viewport. */
  history(start: number, count: number): readonly HistoryRow[] {
    const total = this.#get(14),
      available = this.#get(15),
      end = Math.min(available, start + count),
      pointLayout = this.#layouts.GhosttyPoint,
      coordinate = this.#layouts.GhosttyPointCoordinate,
      refLayout = this.#layouts.GhosttyGridRef,
      styleLayout = this.#layouts.GhosttyStyle,
      point = this.#alloc(pointLayout.size),
      ref = this.#alloc(refLayout.size),
      rawCell = this.#alloc(8),
      rawRow = this.#alloc(8),
      value = this.#alloc(8),
      style = this.#alloc(styleLayout.size),
      graphemes = this.#alloc(256),
      length = this.#alloc(4),
      result: HistoryRow[] = [];
    // `total` is deliberately read even though `available` determines the range:
    // it exercises Ghostty's documented total/scrollback coordinate contract.
    void total;
    try {
      const view = this.#view(),
        pointValue = point + pointLayout.fields.value.offset;
      view.setInt32(point + pointLayout.fields.tag.offset, 3, true); // HISTORY
      for (let row = start; row < end; row++) {
        const cells: ScreenCell[] = [];
        view.setUint32(pointValue + coordinate.fields.y.offset, row, true);
        view.setUint16(pointValue + coordinate.fields.x.offset, 0, true);
        view.setUint32(ref + refLayout.fields.size.offset, refLayout.size, true);
        let wrapped = false,
          kittyVirtualPlaceholder = false;
        if (this.#e.ghostty_terminal_grid_ref(this.#terminal, point, ref) === 0) {
          this.#e.ghostty_grid_ref_row(ref, rawRow);
          const row = view.getBigUint64(rawRow, true);
          this.#e.ghostty_row_get(row, 1, value);
          wrapped = view.getUint8(value) !== 0;
          this.#e.ghostty_row_get(row, 7, value);
          kittyVirtualPlaceholder = view.getUint8(value) !== 0;
        }
        for (let column = 0; column < this.#viewport.columns; column++) {
          view.setUint16(pointValue + coordinate.fields.x.offset, column, true);
          view.setUint32(ref + refLayout.fields.size.offset, refLayout.size, true);
          let text = "",
            width: 0 | 1 | 2 = 1,
            continuation = false,
            cellStyle = defaultStyle,
            hyperlink: string | undefined;
          if (this.#e.ghostty_terminal_grid_ref(this.#terminal, point, ref) === 0) {
            this.#e.ghostty_grid_ref_cell(ref, rawCell);
            const cell = view.getBigUint64(rawCell, true);
            this.#e.ghostty_cell_get(cell, 3, value);
            const wide = view.getInt32(value, true);
            continuation = wide === 2 || wide === 3;
            width = continuation ? 0 : wide === 1 ? 2 : 1;
            view.setUint32(length, 0, true);
            if (this.#e.ghostty_grid_ref_graphemes(ref, graphemes, 64, length) === 0) {
              text = Array.from({ length: view.getUint32(length, true) }, (_, index) =>
                String.fromCodePoint(view.getUint32(graphemes + index * 4, true)),
              ).join("");
            }
            view.setUint32(style + styleLayout.fields.size.offset, styleLayout.size, true);
            if (this.#e.ghostty_grid_ref_style(ref, style) === 0)
              cellStyle = this.#styleFromPointer(style);
            view.setUint32(length, 0, true);
            if (this.#e.ghostty_grid_ref_hyperlink_uri(ref, 0, 0, length) !== 0) {
              const hyperlinkLength = view.getUint32(length, true);
              if (hyperlinkLength) {
                const buffer = this.#alloc(hyperlinkLength);
                try {
                  if (
                    this.#e.ghostty_grid_ref_hyperlink_uri(ref, buffer, hyperlinkLength, length) ===
                    0
                  )
                    hyperlink = decoder.decode(
                      this.#bytes().subarray(buffer, buffer + hyperlinkLength),
                    );
                } finally {
                  this.#release(buffer, hyperlinkLength);
                }
              }
            }
          }
          cells.push(
            Object.freeze({
              column,
              text,
              width,
              continuation,
              style: cellStyle,
              selected: false,
              ...(hyperlink ? { hyperlink } : {}),
            }),
          );
        }
        const text = cells
          .map((cell) => (cell.continuation ? "" : cell.style.invisible ? " " : cell.text || " "))
          .join("");
        result.push(
          Object.freeze({
            line: Object.freeze({ row, cells: Object.freeze(cells), wrapped, text }),
            kittyVirtualPlaceholder,
          }),
        );
      }
      return Object.freeze(result);
    } finally {
      for (const [pointer, size] of [
        [point, pointLayout.size],
        [ref, refLayout.size],
        [rawCell, 8],
        [rawRow, 8],
        [value, 8],
        [style, styleLayout.size],
        [graphemes, 256],
        [length, 4],
      ] as const)
        this.#release(pointer, size);
    }
  }
  #kittyImage(graphics: number, id: number): KittyImageSnapshot | undefined {
    if (!this.#kittySupported) return undefined;
    const image = this.#e.ghostty_kitty_graphics_image(graphics, id);
    if (!image) return undefined;
    const output = this.#alloc(8);
    const getU32 = (kind: number) => {
      if (this.#e.ghostty_kitty_graphics_image_get(image, kind, output) !== 0) return 0;
      return this.#view().getUint32(output, true);
    };
    try {
      const imageId = getU32(1),
        number = getU32(2),
        width = getU32(3),
        height = getU32(4),
        formatValue = getU32(5),
        compression = getU32(6),
        dataPointer = getU32(7),
        dataLength = getU32(8);
      if (compression !== 0 || dataLength > this.#kittyStorageLimit)
        throw new AssetIntegrityError("Invalid Kitty decoded image storage metadata");
      this.#e.ghostty_kitty_graphics_image_get(image, 9, output);
      const generation = this.#view().getBigUint64(output, true).toString(),
        key = `${imageId}:${generation}`,
        cached = this.#images.get(key);
      if (cached) return cached;
      const data = this.#bytes().slice(dataPointer, dataPointer + dataLength),
        format = (["rgb", "rgba", "png", "gray-alpha", "gray"] as const)[formatValue];
      if (!format || format === "png")
        throw new AssetIntegrityError("Invalid Kitty decoded image format");
      const snapshot = freeze({
        id: imageId,
        number,
        generation,
        width,
        height,
        format,
        compression: "none" as const,
        dataLength,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
      this.#images.set(key, snapshot);
      return snapshot;
    } finally {
      this.#release(output, 8);
    }
  }
  #pruneKittyImages() {
    for (const key of this.#images.keys())
      if (!this.#currentImageKeys.has(key)) this.#images.delete(key);
  }
  graphics(): KittyGraphicsSnapshot {
    if (!this.#kittySupported)
      return freeze({ supported: false, generation: "0", storageLimitBytes: 0, placements: [] });
    const graphicsOutput = this.#alloc(4);
    try {
      if (this.#e.ghostty_terminal_get(this.#terminal, 30, graphicsOutput) !== 0)
        throw new AssetIntegrityError("Kitty graphics capability disappeared from the terminal");
      const graphics = this.#view().getUint32(graphicsOutput, true),
        generationOutput = this.#alloc(8);
      try {
        if (this.#e.ghostty_kitty_graphics_get(graphics, 2, generationOutput) !== 0)
          throw new AssetIntegrityError("Unable to read Kitty graphics generation");
        const generation = this.#view().getBigUint64(generationOutput, true).toString(),
          iteratorOutput = this.#alloc(4),
          placements: KittyPlacementSnapshot[] = [];
        try {
          if (this.#e.ghostty_kitty_graphics_placement_iterator_new(0, iteratorOutput) !== 0)
            throw new AssetIntegrityError("Unable to allocate Kitty placement iterator");
          const iterator = this.#view().getUint32(iteratorOutput, true),
            value = this.#alloc(4),
            render = this.#alloc(48);
          try {
            if (this.#e.ghostty_kitty_graphics_get(graphics, 1, iteratorOutput) !== 0)
              throw new AssetIntegrityError("Unable to initialize Kitty placement iterator");
            while (this.#e.ghostty_kitty_graphics_placement_next(iterator)) {
              const get = (kind: number, signed = false) => {
                if (this.#e.ghostty_kitty_graphics_placement_get(iterator, kind, value) !== 0)
                  throw new AssetIntegrityError(`Unable to read Kitty placement field ${kind}`);
                return signed
                  ? this.#view().getInt32(value, true)
                  : this.#view().getUint32(value, true);
              };
              const imageId = get(1),
                virtual = get(3) !== 0,
                image = this.#kittyImage(graphics, imageId);
              if (!image) continue;
              const z = get(12, true),
                requestedSource = {
                  x: get(6),
                  y: get(7),
                  width: get(8),
                  height: get(9),
                },
                imageHandle = this.#e.ghostty_kitty_graphics_image(graphics, imageId);
              let renderInfoAvailable = false;
              if (!virtual && imageHandle) {
                this.#view().setUint32(render, 48, true);
                // Geometry can be unavailable for an individual placement (for
                // example, after an unsupported protocol edge case). It is
                // observational state, not an artifact-integrity failure.
                renderInfoAvailable =
                  this.#e.ghostty_kitty_graphics_placement_render_info(
                    iterator,
                    imageHandle,
                    this.#terminal,
                    render,
                  ) === 0;
              }
              const visible = renderInfoAvailable && this.#view().getUint8(render + 28) !== 0,
                placement = freeze({
                  imageId,
                  placementId: get(2),
                  imageGeneration: image.generation,
                  image,
                  virtual,
                  z,
                  layer:
                    z < -1_073_741_824
                      ? ("below-background" as const)
                      : z < 0
                        ? ("below-text" as const)
                        : ("above-text" as const),
                  offset: { xPixels: get(4), yPixels: get(5) },
                  requestedGrid: { columns: get(10), rows: get(11) },
                  ...(renderInfoAvailable
                    ? {
                        renderedGrid: {
                          columns: this.#view().getUint32(render + 12, true),
                          rows: this.#view().getUint32(render + 16, true),
                        },
                        renderedPixels: {
                          width: this.#view().getUint32(render + 4, true),
                          height: this.#view().getUint32(render + 8, true),
                        },
                      }
                    : {}),
                  viewport: visible
                    ? {
                        column: this.#view().getInt32(render + 20, true),
                        row: this.#view().getInt32(render + 24, true),
                        visible,
                      }
                    : { visible: false },
                  source: renderInfoAvailable
                    ? {
                        x: this.#view().getUint32(render + 32, true),
                        y: this.#view().getUint32(render + 36, true),
                        width: this.#view().getUint32(render + 40, true),
                        height: this.#view().getUint32(render + 44, true),
                      }
                    : requestedSource,
                } satisfies KittyPlacementSnapshot);
              placements.push(placement);
            }
          } finally {
            this.#e.ghostty_kitty_graphics_placement_iterator_free(iterator);
            this.#release(value, 4);
            this.#release(render, 48);
          }
        } finally {
          this.#release(iteratorOutput, 4);
        }
        const currentImageKeys = new Set(
          placements.map((placement) => `${placement.imageId}:${placement.imageGeneration}`),
        );
        // Placement iteration cannot enumerate unplaced images. Revalidate
        // explicitly inspected IDs against the active Ghostty storage so they
        // remain cache-visible until deleted or replaced.
        for (const id of this.#inspectedImageIds) {
          const image = this.#kittyImage(graphics, id);
          if (image) currentImageKeys.add(`${image.id}:${image.generation}`);
          else this.#inspectedImageIds.delete(id);
        }
        this.#currentImageKeys = currentImageKeys;
        this.#pruneKittyImages();
        return freeze({
          supported: true,
          generation,
          storageLimitBytes: this.#kittyStorageLimit,
          placements: Object.freeze(placements),
        });
      } finally {
        this.#release(generationOutput, 8);
      }
    } finally {
      this.#release(graphicsOutput, 4);
    }
  }
  inspectImage(id: number) {
    const graphics = this.#alloc(4);
    try {
      if (!this.#kittySupported || this.#e.ghostty_terminal_get(this.#terminal, 30, graphics) !== 0)
        return undefined;
      const image = this.#kittyImage(this.#view().getUint32(graphics, true), id);
      if (image) {
        this.#inspectedImageIds.add(id);
        this.#currentImageKeys.add(`${image.id}:${image.generation}`);
      }
      this.#pruneKittyImages();
      return image;
    } finally {
      this.#release(graphics, 4);
    }
  }
  copyImageData(id: number) {
    const graphics = this.#alloc(4);
    try {
      if (!this.#kittySupported || this.#e.ghostty_terminal_get(this.#terminal, 30, graphics) !== 0)
        return undefined;
      const image = this.inspectImage(id);
      if (!image) return undefined;
      const handle = this.#e.ghostty_kitty_graphics_image(
        this.#view().getUint32(graphics, true),
        id,
      );
      if (!handle) return undefined;
      const output = this.#alloc(8);
      try {
        if (
          this.#e.ghostty_kitty_graphics_image_get(handle, 7, output) !== 0 ||
          this.#e.ghostty_kitty_graphics_image_get(handle, 8, output + 4) !== 0
        )
          return undefined;
        const pointer = this.#view().getUint32(output, true),
          length = this.#view().getUint32(output + 4, true);
        return this.#bytes().slice(pointer, pointer + length);
      } finally {
        this.#release(output, 8);
      }
    } finally {
      this.#release(graphics, 4);
    }
  }
  cachedImage(id: number) {
    return [...this.#images.entries()].find(
      ([key, image]) => image.id === id && this.#currentImageKeys.has(key),
    )?.[1];
  }
  snapshot(cause?: "pty-output" | "resize" | "reset") {
    const pointLayout = this.#layouts.GhosttyPoint,
      coordinateLayout = this.#layouts.GhosttyPointCoordinate,
      refLayout = this.#layouts.GhosttyGridRef,
      styleLayout = this.#layouts.GhosttyStyle,
      bufferLayout = this.#layouts.GhosttyBuffer,
      point = this.#alloc(pointLayout.size),
      ref = this.#alloc(refLayout.size),
      rawCell = this.#alloc(8),
      rawRow = this.#alloc(8),
      style = this.#alloc(styleLayout.size),
      value = this.#alloc(8),
      textBuffer = this.#alloc(4096),
      buffer = this.#alloc(bufferLayout.size),
      length = this.#alloc(4),
      rowKeys = this.#alloc(16),
      rowValues = this.#alloc(16),
      cellKeys = this.#alloc(12),
      cellValues = this.#alloc(12),
      contentTagValue = this.#alloc(4),
      wideValuePointer = this.#alloc(4),
      hyperlinkValue = this.#alloc(4),
      lines: ScreenLine[] = [];
    this.#e.ghostty_render_state_update(this.#renderState, this.#terminal);
    try {
      const view = this.#view(),
        pointValueOffset = pointLayout.fields.value.offset;
      view.setInt32(point + pointLayout.fields.tag.offset, 1, true);
      for (const [index, key] of [1, 2, 7, 9].entries())
        view.setInt32(rowKeys + index * 4, key, true);
      for (const [index, pointer] of [rawCell, style, value, buffer].entries())
        view.setUint32(rowValues + index * 4, pointer, true);
      for (const [index, key] of [2, 3, 7].entries())
        view.setInt32(cellKeys + index * 4, key, true);
      for (const [index, pointer] of [contentTagValue, wideValuePointer, hyperlinkValue].entries())
        view.setUint32(cellValues + index * 4, pointer, true);
      if (this.#e.ghostty_render_state_get(this.#renderState, 4, this.#rowIteratorHolder) !== 0)
        throw new Error("Unable to initialize Ghostty render row iterator");
      for (let row = 0; row < this.#viewport.rows; row++) {
        const cells: ScreenCell[] = [];
        if (!this.#e.ghostty_render_state_row_iterator_next(this.#rowIterator)) break;
        if (this.#e.ghostty_render_state_row_get(this.#rowIterator, 3, this.#rowCellsHolder) !== 0)
          throw new Error(`Unable to read Ghostty render row ${row}`);
        this.#e.ghostty_render_state_row_get(this.#rowIterator, 2, rawRow);
        const rowValue = view.getBigUint64(rawRow, true);
        this.#e.ghostty_row_get(rowValue, 1, value);
        const wrapped = view.getUint8(value) !== 0;
        for (let column = 0; column < this.#viewport.columns; column++) {
          if (!this.#e.ghostty_render_state_row_cells_next(this.#rowCells)) break;
          view.setUint32(buffer + bufferLayout.fields.ptr.offset, textBuffer, true);
          view.setUint32(buffer + bufferLayout.fields.cap.offset, 4096, true);
          view.setUint32(buffer + bufferLayout.fields.len.offset, 0, true);
          if (
            this.#e.ghostty_render_state_row_cells_get_multi(
              this.#rowCells,
              4,
              rowKeys,
              rowValues,
              length,
            ) !== 0
          )
            throw new Error(`Unable to read Ghostty render cell ${column},${row}`);
          const cellValue = view.getBigUint64(rawCell, true);
          if (this.#e.ghostty_cell_get_multi(cellValue, 3, cellKeys, cellValues, length) !== 0)
            throw new Error(`Unable to decode Ghostty cell ${column},${row}`);
          const wideValue = view.getInt32(wideValuePointer, true),
            continuation = wideValue === 2 || wideValue === 3,
            width: 0 | 1 | 2 = continuation ? 0 : wideValue === 1 ? 2 : 1,
            textLength = view.getUint32(buffer + bufferLayout.fields.len.offset, true),
            text =
              textLength > 0
                ? decoder.decode(this.#bytes().subarray(textBuffer, textBuffer + textLength))
                : "";

          view.setUint32(style + styleLayout.fields.size.offset, styleLayout.size, true);
          let cellStyle: CellStyle = Object.freeze({
            bold: view.getUint8(style + styleLayout.fields.bold.offset) !== 0,
            italic: view.getUint8(style + styleLayout.fields.italic.offset) !== 0,
            faint: view.getUint8(style + styleLayout.fields.faint.offset) !== 0,
            blink: view.getUint8(style + styleLayout.fields.blink.offset) !== 0,
            inverse: view.getUint8(style + styleLayout.fields.inverse.offset) !== 0,
            invisible: view.getUint8(style + styleLayout.fields.invisible.offset) !== 0,
            strikethrough: view.getUint8(style + styleLayout.fields.strikethrough.offset) !== 0,
            overline: view.getUint8(style + styleLayout.fields.overline.offset) !== 0,
            underline: view.getInt32(style + styleLayout.fields.underline.offset, true),
            foreground: this.#color(style, "fg_color"),
            background: this.#color(style, "bg_color"),
            underlineColor: this.#color(style, "underline_color"),
          });
          const contentTag = view.getInt32(contentTagValue, true);
          if (contentTag === 2) {
            this.#e.ghostty_cell_get(cellValue, 10, value);
            cellStyle = Object.freeze({
              ...cellStyle,
              background: { kind: "palette" as const, index: view.getUint8(value) },
            });
          } else if (contentTag === 3) {
            this.#e.ghostty_cell_get(cellValue, 11, value);
            cellStyle = Object.freeze({
              ...cellStyle,
              background: {
                kind: "rgb" as const,
                red: view.getUint8(value),
                green: view.getUint8(value + 1),
                blue: view.getUint8(value + 2),
              },
            });
          }
          const selected = view.getUint8(value) !== 0;

          let hyperlink: string | undefined;
          if (view.getUint8(hyperlinkValue) !== 0) {
            view.setUint16(
              point + pointValueOffset + coordinateLayout.fields.x.offset,
              column,
              true,
            );
            view.setUint32(point + pointValueOffset + coordinateLayout.fields.y.offset, row, true);
            view.setUint32(ref + refLayout.fields.size.offset, refLayout.size, true);
            if (this.#e.ghostty_terminal_grid_ref(this.#terminal, point, ref) === 0) {
              view.setUint32(length, 0, true);
              this.#e.ghostty_grid_ref_hyperlink_uri(ref, 0, 0, length);
              const hyperlinkLength = view.getUint32(length, true);
              if (hyperlinkLength > 0) {
                const hyperlinkBuffer = this.#alloc(hyperlinkLength);
                try {
                  if (
                    this.#e.ghostty_grid_ref_hyperlink_uri(
                      ref,
                      hyperlinkBuffer,
                      hyperlinkLength,
                      length,
                    ) === 0
                  )
                    hyperlink = decoder.decode(
                      this.#bytes().subarray(hyperlinkBuffer, hyperlinkBuffer + hyperlinkLength),
                    );
                } finally {
                  this.#release(hyperlinkBuffer, hyperlinkLength);
                }
              }
            }
          }
          cells.push(
            Object.freeze({
              column,
              text,
              width,
              continuation,
              style: cellStyle,
              selected,
              ...(hyperlink ? { hyperlink } : {}),
            }),
          );
        }
        while (cells.length < this.#viewport.columns)
          cells.push(
            Object.freeze({
              column: cells.length,
              text: "",
              width: 1,
              continuation: false,
              style: defaultStyle,
              selected: false,
            }),
          );
        const rowText = cells
          .map((entry) =>
            entry.continuation ? "" : entry.style.invisible ? " " : entry.text || " ",
          )
          .join("");
        lines.push(Object.freeze({ row, cells: Object.freeze(cells), wrapped, text: rowText }));
      }
      while (lines.length < this.#viewport.rows) {
        const row = lines.length,
          cells = Array.from({ length: this.#viewport.columns }, (_, column) =>
            Object.freeze({
              column,
              text: "",
              width: 1 as const,
              continuation: false,
              style: defaultStyle,
              selected: false,
            }),
          );
        lines.push(
          Object.freeze({
            row,
            cells: Object.freeze(cells),
            wrapped: false,
            text: " ".repeat(this.#viewport.columns),
          }),
        );
      }
    } finally {
      for (const [pointer, size] of [
        [point, pointLayout.size],
        [ref, refLayout.size],
        [rawCell, 8],
        [rawRow, 8],
        [style, styleLayout.size],
        [value, 8],
        [textBuffer, 4096],
        [buffer, bufferLayout.size],
        [length, 4],
        [rowKeys, 16],
        [rowValues, 16],
        [cellKeys, 12],
        [cellValues, 12],
        [contentTagValue, 4],
        [wideValuePointer, 4],
        [hyperlinkValue, 4],
      ] as const)
        this.#release(pointer, size);
    }
    const shapeValue = this.#renderGet(10),
      cursor = {
        column: this.#renderGet(15, 2),
        row: this.#renderGet(16, 2),
        visible: this.#renderGet(11, 1) !== 0 && this.#renderGet(14, 1) !== 0,
        shape:
          shapeValue === 0
            ? ("bar" as const)
            : shapeValue === 2
              ? ("underline" as const)
              : ("block" as const),
        blinking: this.#renderGet(12, 1) !== 0,
      },
      activeBuffer = this.#get(6) === 1 ? ("alternate" as const) : ("primary" as const),
      visualState = JSON.stringify([lines, cursor, activeBuffer, this.#viewport]),
      visual = visualState !== this.#previous;
    if (visual) this.#lastVisual = this.now();
    if (cause && visual) this.#sequence++;
    this.#previous = visualState;
    const workingDirectory = this.#terminalString(13);
    return freeze({
      sequence: this.#sequence,
      timestamp: this.now(),
      lastVisualChangeAt: this.#lastVisual,
      viewport: this.#viewport,
      activeBuffer,
      graphics: this.graphics(),
      cursor,
      lines,
      modes: this.modes(),
      title: this.#terminalString(12),
      ...(workingDirectory ? { workingDirectory } : {}),
    } satisfies ScreenSnapshot);
  }
  encodeKey(input: KeyName | KeyPress) {
    const event = typeof input === "string" ? { key: input } : input,
      name = event.key,
      functional: Record<string, number> = {
        Backspace: 53,
        Enter: 58,
        Tab: 64,
        Delete: 68,
        End: 69,
        Home: 71,
        PageDown: 73,
        PageUp: 74,
        ArrowDown: 75,
        ArrowLeft: 76,
        ArrowRight: 77,
        ArrowUp: 78,
        Escape: 120,
      };
    let key = functional[name] ?? 0,
      text = "";
    const functionMatch = /^F(\d+)$/.exec(name);
    if (functionMatch) {
      const number = Number(functionMatch[1]);
      if (number >= 1 && number <= 25) key = 120 + number;
    } else if ([...name].length === 1) {
      const codepoint = name.codePointAt(0)!;
      if (/[a-z]/i.test(name)) key = 20 + name.toLowerCase().charCodeAt(0) - 97;
      else if (/\d/.test(name)) key = 6 + Number(name);
      text = event.shift ? name.toUpperCase() : name;
      this.#e.ghostty_key_event_set_unshifted_codepoint(
        this.#keyEvent,
        name.toLowerCase().codePointAt(0) ?? codepoint,
      );
    }
    let modifiers = 0;
    if (event.shift) modifiers |= 1;
    if (event.control) modifiers |= 2;
    if (event.alt) modifiers |= 4;
    if (event.super) modifiers |= 8;
    this.#e.ghostty_key_event_set_action(this.#keyEvent, 1);
    this.#e.ghostty_key_event_set_key(this.#keyEvent, key);
    this.#e.ghostty_key_event_set_mods(this.#keyEvent, modifiers);
    const utf8 = encoder.encode(text),
      utf8Pointer = utf8.length ? this.#alloc(utf8.length) : 0;
    if (utf8.length) this.#bytes().set(utf8, utf8Pointer);
    this.#e.ghostty_key_event_set_utf8(this.#keyEvent, utf8Pointer, utf8.length);
    this.#e.ghostty_key_encoder_setopt_from_terminal(this.#keyEncoder, this.#terminal);
    const output = this.#alloc(256),
      length = this.#alloc(4);
    try {
      if (
        this.#e.ghostty_key_encoder_encode(
          this.#keyEncoder,
          this.#keyEvent,
          output,
          256,
          length,
        ) !== 0
      )
        throw new Error(`Ghostty could not encode key ${JSON.stringify(name)}`);
      return this.#bytes().slice(output, output + this.#view().getUint32(length, true));
    } finally {
      if (utf8.length) this.#release(utf8Pointer, utf8.length);
      this.#release(output, 256);
      this.#release(length, 4);
    }
  }
  encodeMouse(
    action: "move" | "down" | "up",
    point: Point,
    options: MouseOptions = {},
    anyButtonPressed = false,
  ) {
    this.#e.ghostty_mouse_encoder_setopt_from_terminal(this.#mouseEncoder, this.#terminal);
    this.#configureMouseSize();
    this.#e.ghostty_mouse_event_set_action(
      this.#mouseEvent,
      action === "down" ? 0 : action === "up" ? 1 : 2,
    );
    if (action === "move" && !anyButtonPressed)
      this.#e.ghostty_mouse_event_clear_button(this.#mouseEvent);
    else {
      const button =
        typeof options.button === "number"
          ? options.button
          : options.button === "middle"
            ? 3
            : options.button === "right"
              ? 2
              : 1;
      this.#e.ghostty_mouse_event_set_button(this.#mouseEvent, button);
    }
    let modifiers = 0;
    if (options.shift) modifiers |= 1;
    if (options.control) modifiers |= 2;
    if (options.alt) modifiers |= 4;
    if (options.super) modifiers |= 8;
    this.#e.ghostty_mouse_event_set_mods(this.#mouseEvent, modifiers);
    const positionLayout = this.#layouts.GhosttyMousePosition,
      position = this.#alloc(positionLayout.size),
      view = this.#view();
    view.setFloat32(position + positionLayout.fields.x.offset, point.column * 10 + 5, true);
    view.setFloat32(position + positionLayout.fields.y.offset, point.row * 20 + 10, true);
    this.#e.ghostty_mouse_event_set_position(this.#mouseEvent, position);
    const pressed = this.#alloc(1),
      output = this.#alloc(256),
      length = this.#alloc(4);
    view.setUint8(pressed, anyButtonPressed ? 1 : 0);
    this.#e.ghostty_mouse_encoder_setopt(this.#mouseEncoder, 3, pressed);
    try {
      if (
        this.#e.ghostty_mouse_encoder_encode(
          this.#mouseEncoder,
          this.#mouseEvent,
          output,
          256,
          length,
        ) !== 0
      )
        throw new Error("Ghostty mouse encoding failed");
      return this.#bytes().slice(output, output + this.#view().getUint32(length, true));
    } finally {
      this.#release(position, positionLayout.size);
      this.#release(pressed, 1);
      this.#release(output, 256);
      this.#release(length, 4);
    }
  }
  encodePaste(text: string) {
    const data = encoder.encode(text),
      p = this.#alloc(data.length || 1),
      lp = this.#alloc(4);
    this.#bytes().set(data, p);
    const bracketed = this.mode(2004);
    this.#e.ghostty_paste_encode(p, data.length, bracketed ? 1 : 0, 0, 0, lp);
    const n = this.#view().getUint32(lp, true),
      out = this.#alloc(n || 1);
    try {
      if (this.#e.ghostty_paste_encode(p, data.length, bracketed ? 1 : 0, out, n, lp) !== 0)
        throw new Error("Ghostty paste encoding failed");
      return this.#bytes().slice(out, out + n);
    } finally {
      this.#release(p, data.length || 1);
      this.#release(lp, 4);
      this.#release(out, n || 1);
    }
  }
  encodeFocus(state: "in" | "out") {
    if (!this.mode(1004)) return new Uint8Array();
    const out = this.#alloc(8),
      lp = this.#alloc(4);
    try {
      if (this.#e.ghostty_focus_encode(state === "in" ? 0 : 1, out, 8, lp) !== 0)
        return new Uint8Array();
      return this.#bytes().slice(out, out + this.#view().getUint32(lp, true));
    } finally {
      this.#release(out, 8);
      this.#release(lp, 4);
    }
  }
  free() {
    if (this.#mouseEvent) this.#e.ghostty_mouse_event_free(this.#mouseEvent);
    if (this.#mouseEncoder) this.#e.ghostty_mouse_encoder_free(this.#mouseEncoder);
    if (this.#keyEvent) this.#e.ghostty_key_event_free(this.#keyEvent);
    if (this.#keyEncoder) this.#e.ghostty_key_encoder_free(this.#keyEncoder);
    if (this.#rowCells) this.#e.ghostty_render_state_row_cells_free(this.#rowCells);
    if (this.#rowIterator) this.#e.ghostty_render_state_row_iterator_free(this.#rowIterator);
    if (this.#renderState) this.#e.ghostty_render_state_free(this.#renderState);
    if (this.#formatter) this.#e.ghostty_formatter_free(this.#formatter);
    if (this.#terminal) this.#e.ghostty_terminal_free(this.#terminal);
    for (const { pointer, size } of this.#allocations.splice(0))
      this.#e.ghostty_wasm_free_u8_array(pointer, size);
    for (const pointer of this.#opaqueAllocations.splice(0))
      this.#e.ghostty_wasm_free_opaque(pointer);
    this.#mouseEvent = this.#mouseEncoder = this.#keyEvent = this.#keyEncoder = 0;
    this.#rowCells = this.#rowIterator = this.#renderState = this.#formatter = this.#terminal = 0;
  }
}

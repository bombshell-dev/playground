// Canonical ABI bindings for the bombshell:css component (wasm32).
//
// All in-memory layouts follow the component-model canonical ABI. Strings
// and lists are (ptr, len) pairs pointing at wasm memory; string bytes are
// copied into linear memory via `cabi_realloc`.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const NO_PARENT = 0xffffffff;

export async function loadCssComponent(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());
  const instance = (await WebAssembly.instantiate(bytes, {})).instance;
  return createComponent(instance);
}

export function loadCssComponentFromModule(module) {
  return createComponent(new WebAssembly.Instance(module, {}));
}

function createComponent(instance) {
  const exports = instance.exports;
  let memory = new Uint8Array(exports.memory.buffer);
  let view = new DataView(exports.memory.buffer);
  const realloc = exports.cabi_realloc;
  const compileFn = exports['bombshell:css/stylesheet@0.3.0#compile'];
  const computeFn = exports['bombshell:css/stylesheet@0.3.0#compute'];
  const prepareFn = exports['bombshell:css/stylesheet@0.3.0#prepare'];
  const releaseFn = exports['bombshell:css/stylesheet@0.3.0#release'];
  const computeTreeFn = exports['bombshell:css/stylesheet@0.3.0#compute-tree'];
  const postComputeTree = exports['cabi_post_bombshell:css/stylesheet@0.3.0#compute-tree'];
  const postCompile = exports['cabi_post_bombshell:css/stylesheet@0.3.0#compile'];
  const postCompute = exports['cabi_post_bombshell:css/stylesheet@0.3.0#compute'];
  function refresh() {
    memory = new Uint8Array(exports.memory.buffer);
    view = new DataView(exports.memory.buffer);
  }

  // Host allocations use `cabi_realloc`: wit-bindgen lifts string/list
  // arguments zero-copy (it takes ownership of the buffer and frees it with
  // its own allocator), so inputs must come from the allocator the callee
  // will free with, and must NOT be freed host-side. Callee-owned return
  // areas are released by the `cabi_post_*` hooks after the host reads.
  function allocate(bytes) {
    const pointer = realloc(0, 0, 1, bytes.byteLength);
    refresh();
    memory.set(bytes, pointer);
    return pointer;
  }

  function writeString(text) {
    return allocate(encoder.encode(text));
  }

  function readString(pointer, length) {
    return decoder.decode(memory.subarray(pointer, pointer + length));
  }

  function u32(pointer) {
    return view.getUint32(pointer, true);
  }

  function f32(pointer) {
    return view.getFloat32(pointer, true);
  }

  function stringPointer(text) {
    const bytes = encoder.encode(text);
    return { pointer: allocate(bytes), length: bytes.byteLength };
  }

  function stringListPointer(items) {
    if (items.length === 0) {
      return { pointer: 0, count: 0 };
    }
    const entries = items.map(stringPointer);
    const pointer = realloc(0, 0, 4, entries.length * 8);
    refresh();
    entries.forEach((entry, i) => {
      view.setUint32(pointer + i * 8, entry.pointer, true);
      view.setUint32(pointer + i * 8 + 4, entry.length, true);
    });
    return { pointer, count: entries.length };
  }

  function attributeListPointer(attributes) {
    if (attributes.length === 0) {
      return { pointer: 0, count: 0 };
    }
    const entries = attributes.map((attribute) => ({
      name: stringPointer(attribute.name),
      value: stringPointer(attribute.value),
    }));
    const pointer = realloc(0, 0, 4, entries.length * 16);
    refresh();
    entries.forEach((entry, i) => {
      const base = pointer + i * 16;
      view.setUint32(base, entry.name.pointer, true);
      view.setUint32(base + 4, entry.name.length, true);
      view.setUint32(base + 8, entry.value.pointer, true);
      view.setUint32(base + 12, entry.value.length, true);
    });
    return { pointer, count: entries.length };
  }

  function compile(css, origin = 2) {
    const bytes = encoder.encode(css);
    const cssPointer = allocate(bytes);
    const result = compileFn(cssPointer, bytes.byteLength, origin);
    refresh();
    // compiled-sheet: option<list<u8>> (disc u8@0, ptr@4, len@8)
    //               + list<diagnostic> (ptr@12, len@16)
    // The option discriminant is one byte; bytes 1..3 are padding the
    // canonical ABI leaves undefined, so they must not leak into the check.
    const hasIr = view.getUint8(result) === 1;
    const irPointer = u32(result + 4);
    const irLength = u32(result + 8);
    const diagnosticsPointer = u32(result + 12);
    const diagnosticsCount = u32(result + 16);
    const ir = hasIr ? memory.slice(irPointer, irPointer + irLength) : null;
    const diagnostics = [];
    for (let i = 0; i < diagnosticsCount; i++) {
      // diagnostic: severity u8@0, code (ptr@4, len@8), message (ptr@12, len@16)
      const base = diagnosticsPointer + i * 16;
      diagnostics.push({
        severity: view.getUint8(base),
        code: readString(u32(base + 4), u32(base + 8)),
        message: readString(u32(base + 12), u32(base + 16)),
      });
    }
    // The callee-allocated return area (and the strings it points to) is
    // released by the post-return hook, after the host has finished reading.
    postCompile(result);
    return { ir, diagnostics };
  }

  /// Decode and parse IR once; returns a handle for `compute`.
  function prepare(ir) {
    const irBytes = ir instanceof Uint8Array ? ir : new Uint8Array(ir);
    const irPointer = allocate(irBytes);
    const result = prepareFn(irPointer, irBytes.byteLength);
    refresh();
    // option<u32>: disc u8@0, value@4 — discriminant is one byte; the
    // canonical ABI leaves bytes 1..3 undefined, so read only the byte.
    return view.getUint8(result) === 1 ? u32(result + 4) : null;
  }

  /// Resolve computed styles for every node in one pass. Returns one
  /// declaration list per node, index-aligned with `nodes`.
  function computeTree(sheet, nodes, parents, env) {
    const stride = 56;
    const data = new Uint8Array(nodes.length * stride);
    const dataView = new DataView(data.buffer);
    nodes.forEach((node, i) => {
      const base = i * stride;
      const tag = stringPointer(node.tag);
      dataView.setUint32(base, tag.pointer, true);
      dataView.setUint32(base + 4, tag.length, true);
      const id = node.id ? stringPointer(node.id) : null;
      dataView.setUint32(base + 8, id ? 1 : 0, true);
      if (id) {
        dataView.setUint32(base + 12, id.pointer, true);
        dataView.setUint32(base + 16, id.length, true);
      }
      const classes = stringListPointer(node.classes ?? []);
      dataView.setUint32(base + 20, classes.pointer, true);
      dataView.setUint32(base + 24, classes.count, true);
      const attributes = attributeListPointer(node.attributes ?? []);
      dataView.setUint32(base + 28, attributes.pointer, true);
      dataView.setUint32(base + 32, attributes.count, true);
      dataView.setUint8(base + 36, node.state ?? 0);
      const hasWidth = node.width !== undefined && node.width !== null;
      const hasHeight = node.height !== undefined && node.height !== null;
      dataView.setUint32(base + 40, hasWidth ? 1 : 0, true);
      dataView.setFloat32(base + 44, hasWidth ? node.width : 0, true);
      dataView.setUint32(base + 48, hasHeight ? 1 : 0, true);
      dataView.setFloat32(base + 52, hasHeight ? node.height : 0, true);
    });
    const nodesPointer = allocate(data);

    const parentBytes = new Uint8Array(parents.length * 4);
    const parentView = new DataView(parentBytes.buffer);
    parents.forEach((parent, i) => parentView.setUint32(i * 4, parent, true));
    const parentPointer = allocate(parentBytes);

    const result = computeTreeFn(
      sheet,
      nodesPointer,
      nodes.length,
      parentPointer,
      parents.length,
      env?.viewportWidth != null ? 1 : 0,
      env?.viewportWidth ?? 0,
      env?.viewportHeight != null ? 1 : 0,
      env?.viewportHeight ?? 0,
      env?.colorScheme === 'dark' ? 1 : 0,
      env?.reducedMotion ? 1 : 0,
      env?.resolution ?? 1,
    );
    refresh();
    // list<list<computed-property>>: (ptr@0, len@4); each entry is
    // (ptr@0, len@4) over 16-byte name/value pairs.
    const outer = u32(result);
    const outerCount = u32(result + 4);
    const perNode = [];
    for (let i = 0; i < outerCount; i++) {
      const entryBase = outer + i * 8;
      const pointer = u32(entryBase);
      const count = u32(entryBase + 4);
      const declarations = [];
      for (let j = 0; j < count; j++) {
        const base = pointer + j * 16;
        declarations.push([
          readString(u32(base), u32(base + 4)),
          readString(u32(base + 8), u32(base + 12)),
        ]);
      }
      perNode.push(declarations);
    }
    postComputeTree(result);
    return perNode;
  }

  function release(sheet) {
    releaseFn(sheet);
  }

  function compute(sheet, nodes, parents, target, env) {
    // node: tag (ptr@0, len@4), id option<string> (disc@8, ptr@12, len@16),
    // classes list<string> (ptr@20, len@24), attributes list<attribute>
    // (ptr@28, len@32), state u8@36, width option<f32> (disc@40, f32@44),
    // height option<f32> (disc@48, f32@52) — 56 bytes per node.
    const stride = 56;
    const data = new Uint8Array(nodes.length * stride);
    const dataView = new DataView(data.buffer);
    nodes.forEach((node, i) => {
      const base = i * stride;
      const tag = stringPointer(node.tag);
      dataView.setUint32(base, tag.pointer, true);
      dataView.setUint32(base + 4, tag.length, true);
      const id = node.id ? stringPointer(node.id) : null;
      dataView.setUint32(base + 8, id ? 1 : 0, true);
      if (id) {
        dataView.setUint32(base + 12, id.pointer, true);
        dataView.setUint32(base + 16, id.length, true);
      }
      const classes = stringListPointer(node.classes ?? []);
      dataView.setUint32(base + 20, classes.pointer, true);
      dataView.setUint32(base + 24, classes.count, true);
      const attributes = attributeListPointer(node.attributes ?? []);
      dataView.setUint32(base + 28, attributes.pointer, true);
      dataView.setUint32(base + 32, attributes.count, true);
      dataView.setUint8(base + 36, node.state ?? 0);
      const hasWidth = node.width !== undefined && node.width !== null;
      const hasHeight = node.height !== undefined && node.height !== null;
      dataView.setUint32(base + 40, hasWidth ? 1 : 0, true);
      dataView.setFloat32(base + 44, hasWidth ? node.width : 0, true);
      dataView.setUint32(base + 48, hasHeight ? 1 : 0, true);
      dataView.setFloat32(base + 52, hasHeight ? node.height : 0, true);
    });
    const nodesPointer = allocate(data);

    const parentBytes = new Uint8Array(parents.length * 4);
    const parentView = new DataView(parentBytes.buffer);
    parents.forEach((parent, i) => parentView.setUint32(i * 4, parent, true));
    const parentPointer = allocate(parentBytes);

    const result = computeFn(
      sheet,
      nodesPointer,
      nodes.length,
      parentPointer,
      parents.length,
      target,
      env?.viewportWidth != null ? 1 : 0,
      env?.viewportWidth ?? 0,
      env?.viewportHeight != null ? 1 : 0,
      env?.viewportHeight ?? 0,
      env?.colorScheme === 'dark' ? 1 : 0,
      env?.reducedMotion ? 1 : 0,
      env?.resolution ?? 1,
    );
    refresh();
    // list<computed-property>: (ptr@0, len@4)
    const pointer = u32(result);
    const count = u32(result + 4);
    const declarations = [];
    for (let i = 0; i < count; i++) {
      // computed-property: name (ptr@0, len@4), value (ptr@8, len@12)
      const base = pointer + i * 16;
      declarations.push([
        readString(u32(base), u32(base + 4)),
        readString(u32(base + 8), u32(base + 12)),
      ]);
    }
    postCompute(result);
    return declarations;
  }

  return { compile, prepare, compute, computeTree, release, raw: exports };
}

// ---------------------------------------------------------------------------
// Postcard reader for CompiledStylesheet (IR_VERSION 2)
// ---------------------------------------------------------------------------

export function decodeIr(bytes) {
  const reader = new IrReader(bytes);
  return {
    version: reader.varint(),
    origin: reader.byte(),
    rules: reader.vec(() => reader.rule()),
    layerOrder: reader.vec(() => reader.stringVec()),
    keyframes: reader.vec(() => ({ name: reader.string(), body: reader.string() })),
    opaque: reader.vec(() => ({ text: reader.string() })),
    warnings: reader.vec(() => reader.diagnostic()),
  };
}

class IrReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.cursor = 0;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  byte() {
    return this.bytes[this.cursor++];
  }

  varint() {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = this.bytes[this.cursor++];
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        break;
      }
      shift += 7;
    }
    return value >>> 0;
  }

  zigzag() {
    const n = this.varint();
    return (n >>> 1) ^ -(n & 1);
  }

  string() {
    const length = this.varint();
    const text = decoder.decode(this.bytes.subarray(this.cursor, this.cursor + length));
    this.cursor += length;
    return text;
  }

  stringVec() {
    return this.vec(() => this.string());
  }

  vec(read) {
    const count = this.varint();
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push(read());
    }
    return items;
  }

  diagnostic() {
    return { severity: this.byte(), code: this.string(), message: this.string() };
  }

  rule() {
    return {
      selector: this.string(),
      specificity: this.varint(),
      layer: this.option(() => this.stringVec()),
      media: this.vec(() => this.mediaCondition()),
      containers: this.vec(() => ({
        name: this.option(() => this.string()),
        condition: this.containerCondition(),
      })),
      supports: this.vec(() => this.supportsCondition()),
      declarations: this.vec(() => ({
        name: this.string(),
        value: this.string(),
        important: this.byte() === 1,
      })),
      order: this.varint(),
    };
  }

  option(read) {
    if (this.byte() === 0) {
      return null;
    }
    return read();
  }

  mediaCondition() {
    const tag = this.varint();
    switch (tag) {
      case 0: return { type: 'feature', feature: this.feature() };
      case 1: return { type: 'not', inner: this.mediaCondition() };
      case 2: return { type: 'and', conditions: this.vec(() => this.mediaCondition()) };
      case 3: return { type: 'or', conditions: this.vec(() => this.mediaCondition()) };
      default: return { type: 'unknown' };
    }
  }

  feature() {
    const name = this.string();
    const kind = this.varint();
    switch (kind) {
      case 0: return { name, kind: { type: 'plain', value: this.featureValue() } };
      case 1: return { name, kind: { type: 'boolean' } };
      case 2: return { name, kind: { type: 'range', cmp: this.varint(), value: this.featureValue() } };
      case 3: return {
        name,
        kind: {
          type: 'interval',
          start: this.featureValue(),
          startCmp: this.varint(),
          end: this.featureValue(),
          endCmp: this.varint(),
        },
      };
      default: throw new Error(`unknown feature kind ${kind}`);
    }
  }

  featureValue() {
    const tag = this.varint();
    switch (tag) {
      case 0: return { type: 'px', value: this.f32() };
      case 1: return { type: 'length', value: this.f32(), unit: this.string() };
      case 2: return { type: 'number', value: this.f32() };
      case 3: return { type: 'integer', value: this.zigzag() };
      case 4: return { type: 'boolean', value: this.byte() === 1 };
      case 5: return { type: 'dppx', value: this.f32() };
      case 6: return { type: 'ratio', a: this.f32(), b: this.f32() };
      case 7: return { type: 'ident', value: this.string() };
      default: return { type: 'unknown' };
    }
  }

  f32() {
    const value = this.view.getFloat32(this.cursor, true);
    this.cursor += 4;
    return value;
  }

  containerCondition() {
    const tag = this.varint();
    switch (tag) {
      case 0: return { type: 'size', feature: this.feature() };
      case 1: return { type: 'style', text: this.string() };
      case 2: return { type: 'not', inner: this.containerCondition() };
      case 3: return { type: 'and', conditions: this.vec(() => this.containerCondition()) };
      case 4: return { type: 'or', conditions: this.vec(() => this.containerCondition()) };
      default: return { type: 'unknown' };
    }
  }

  supportsCondition() {
    const tag = this.varint();
    switch (tag) {
      case 0: return { type: 'declaration', name: this.string(), value: this.string(), supported: this.byte() === 1 };
      case 1: return { type: 'selector', text: this.string(), supported: this.byte() === 1 };
      case 2: return { type: 'not', inner: this.supportsCondition() };
      case 3: return { type: 'and', conditions: this.vec(() => this.supportsCondition()) };
      case 4: return { type: 'or', conditions: this.vec(() => this.supportsCondition()) };
      default: return { type: 'unknown' };
    }
  }
}

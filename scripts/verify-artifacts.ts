import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const root = new URL("..", import.meta.url),
  lock = JSON.parse(await readFile(new URL("ghostty.lock.json", root), "utf8"));
if (lock.protocolVersion !== 1 || lock.bindingVersion !== 1)
  throw new Error("protocol or binding version mismatch");
for (const [path, entry] of Object.entries(lock.artifacts) as [string, { sha256: string }][]) {
  const actual = createHash("sha256")
    .update(await readFile(new URL(path, root)))
    .digest("hex");
  if (actual !== entry.sha256)
    throw new Error(`${path}: checksum mismatch (expected ${entry.sha256}, got ${actual})`);
}
for (const path of Object.keys(lock.artifacts).filter((path) => path.includes("pty-host-"))) {
  const binary = await readFile(new URL(path, root));
  if (!binary.includes(Buffer.from(`GWPT_PROTOCOL_VERSION=${lock.protocolVersion}`)))
    throw new Error(`${path}: protocol marker mismatch`);
}
const wasmBytes = await readFile(new URL("artifacts/ghostty-vt.wasm", root)),
  wasm = await WebAssembly.compile(wasmBytes),
  exports = new Set(WebAssembly.Module.exports(wasm).map((x) => x.name));
for (const name of lock.requiredWasmExports)
  if (!exports.has(name)) throw new Error(`ghostty-vt.wasm: missing export ${name}`);
const instance = await WebAssembly.instantiate(wasm, { env: { log() {} } }),
  wasmExports = instance.exports as Record<string, any>,
  pointer = wasmExports.ghostty_type_json(),
  bytes = new Uint8Array((wasmExports.memory as WebAssembly.Memory).buffer);
let end = pointer;
while (bytes[end] !== 0) end++;
const layouts = JSON.parse(new TextDecoder().decode(bytes.subarray(pointer, end)));
for (const [name, size] of Object.entries(lock.abi.structSizes))
  if (layouts[name]?.size !== size)
    throw new Error(
      `ghostty-vt.wasm: ${name} size mismatch (expected ${size}, got ${layouts[name]?.size})`,
    );
console.log(
  `verified ${Object.keys(lock.artifacts).length} Ghostwright artifacts and ${Object.keys(lock.abi.structSizes).length} ABI layouts`,
);

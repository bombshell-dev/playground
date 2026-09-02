import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { GhostwrightError } from '../src/errors.ts';
const root = new URL('..', import.meta.url),
	lock = JSON.parse(await readFile(new URL('ghostty.lock.json', root), 'utf8'));
if (lock.protocolVersion !== 1 || lock.bindingVersion !== 2)
	throw new GhostwrightError({
		code: 'GW_VERSION_MISMATCH',
		message: 'protocol or binding version mismatch',
	});
// The manifest records every release target, but a developer machine only
// builds its own platform. Absent artifacts are skipped and reported; artifacts
// that are present are always verified strictly.
const absent = new Set<string>(),
	read = async (artifactPath: string): Promise<Buffer | undefined> => {
		try {
			return await readFile(new URL(artifactPath, root));
		} catch (error: any) {
			if (error?.code !== 'ENOENT') throw error;
			absent.add(artifactPath);
			return undefined;
		}
	};
let verified = 0;
for (const [artifactPath, entry] of Object.entries(lock.artifacts) as [
	string,
	{ sha256: string },
][]) {
	const contents = await read(artifactPath);
	if (!contents) continue;
	const actual = createHash('sha256').update(contents).digest('hex');
	if (actual !== entry.sha256)
		throw new GhostwrightError({
			code: 'GW_CHECKSUM_MISMATCH',
			message: `${artifactPath}: checksum mismatch (expected ${entry.sha256}, got ${actual})`,
		});
	verified++;
}
for (const artifactPath of Object.keys(lock.artifacts).filter((p) => p.includes('pty-host-'))) {
	const binary = await read(artifactPath);
	if (!binary) continue;
	if (!binary.includes(Buffer.from(`GWPT_PROTOCOL_VERSION=${lock.protocolVersion}`)))
		throw new GhostwrightError({
			code: 'GW_PROTOCOL_MARKER',
			message: `${artifactPath}: protocol marker mismatch`,
		});
}
if (verified === 0)
	throw new GhostwrightError({
		code: 'GW_NO_ARTIFACTS',
		message: 'no Ghostwright artifacts found; run `bun run build:artifacts` first',
	});
const wasmBytes = await readFile(new URL('artifacts/ghostty-vt.wasm', root)),
	wasm = await WebAssembly.compile(wasmBytes),
	exports = new Set(WebAssembly.Module.exports(wasm).map((x) => x.name));
for (const name of lock.requiredWasmExports)
	if (!exports.has(name))
		throw new GhostwrightError({
			code: 'GW_MISSING_WASM_EXPORT',
			message: `ghostty-vt.wasm: missing export ${name}`,
		});
const instance = await WebAssembly.instantiate(wasm, { env: { log() {} } }),
	wasmExports = instance.exports as Record<string, any>,
	pointer = wasmExports.ghostty_type_json(),
	bytes = new Uint8Array((wasmExports.memory as WebAssembly.Memory).buffer);
let end = pointer;
while (bytes[end] !== 0) end++;
const layouts = JSON.parse(new TextDecoder().decode(bytes.subarray(pointer, end)));
for (const [name, size] of Object.entries(lock.abi.structSizes))
	if (layouts[name]?.size !== size)
		throw new GhostwrightError({
			code: 'GW_ABI_MISMATCH',
			message: `ghostty-vt.wasm: ${name} size mismatch (expected ${size}, got ${layouts[name]?.size})`,
		});
if (lock.graphics?.kittyGraphics) {
	const out = wasmExports.ghostty_wasm_alloc_u8_array(1);
	try {
		if (wasmExports.ghostty_build_info(2, out) !== 0 || bytes[out] === 0)
			throw new GhostwrightError({
				code: 'GW_KITTY_GRAPHICS',
				message: 'ghostty-vt.wasm: Kitty graphics capability is absent',
			});
	} finally {
		wasmExports.ghostty_wasm_free_u8_array(out, 1);
	}
}
// oxlint-disable-next-line no-console -- verify script
console.log(
	`verified ${verified} Ghostwright artifacts and ${Object.keys(lock.abi.structSizes).length} ABI layouts${
		absent.size ? `; skipped ${absent.size} not built here (${[...absent].join(', ')})` : ''
	}`,
);

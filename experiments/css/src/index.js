// @bomb.sh/css — bindings and runtime for the bombshell:css component
// (WIT world `bombshell:css@0.4.0`).
//
// - `compiled` is the freestanding wasm module (brotli+Z85 embedded; the
//   module is decoded eagerly at import and ready for synchronous
//   instantiation). Regenerate with `node scripts/bundle-wasm.mjs`.
// - `compile(css)` is the main entry: it compiles CSS text, prepares the
//   sheet, and returns a disposable `Sheet` — `using sheet = compile(css)`
//   releases it at scope exit (`await using` also works; release is
//   synchronous). The Sheet carries `ir` bytes, `diagnostics`, and lazily
//   decoded `version`/`rules`.
// - `compute(sheet, ...)` / `computeTree(sheet, ...)` / `release(sheet)` are
//   free-function alternatives to the Sheet methods.
// - `createEngine()` hosts any number of sheets, cascaded natively by the
//   component (see engine.js).
// - For hosts that ship their own artifact: `loadCssComponent(bytes)` /
//   `loadCssComponentFromModule(module)` return the raw ABI object
//   (`compile`/`prepare`/`compute`/`computeTree`/`release`/`raw`).
//
// The embedded artifact decodes via `node:zlib`, so it targets Node-like
// runtimes; browser hosts load the raw module and use `loadCssComponent`.
import { compiled } from "./wasm.js";
import { decodeIr as decodeIrBytes, loadCssComponentFromModule } from "./abi.js";
export { NO_PARENT, loadCssComponent, loadCssComponentFromModule } from "./abi.js";
export { compiled };

export const component = loadCssComponentFromModule(compiled);

/// Compile CSS text into a prepared, disposable Sheet. Throws `CompileError`
/// (with `diagnostics`) if compilation produced no IR; warnings-only
/// compiles still succeed with `sheet.diagnostics` populated.
export function compile(css, origin = 2) {
	const { ir, diagnostics } = component.compile(css, origin);
	if (ir === null) {
		throw new CompileError(diagnostics);
	}
	const handle = component.prepare(ir);
	if (handle === null) {
		throw new Error("prepare rejected the IR");
	}
	return new Sheet(handle, ir, diagnostics);
}

export function compute(sheet, nodes, parents, target, env) {
	return component.compute([handleOf(sheet)], nodes, parents, target, env);
}

export function computeTree(sheet, nodes, parents, env) {
	return component.computeTree([handleOf(sheet)], nodes, parents, env);
}

export function release(sheet) {
	if (sheet instanceof Sheet) {
		sheet.release();
	} else {
		component.release(sheet);
	}
}

/// Decode the compiled stylesheet IR for inspection. Accepts a Sheet or raw
/// IR bytes.
export function decodeIr(sheet) {
	return decodeIrBytes(sheet instanceof Sheet ? sheet.ir : sheet);
}

function handleOf(sheet) {
	return sheet instanceof Sheet ? sheet.handle : sheet;
}

/// Thrown when compilation produces no IR. `diagnostics` holds the
/// severity/code/message list from the engine.
export class CompileError extends Error {
	constructor(diagnostics) {
		super("compile returned no IR");
		this.name = "CompileError";
		this.diagnostics = diagnostics;
	}
}

/// A prepared stylesheet. Wraps the raw handle so calls don't repeat it, and
/// releases itself at scope exit: `using sheet = compile(css)`.
export class Sheet {
	constructor(handle, ir, diagnostics) {
		this.handle = handle;
		this.ir = ir;
		this.diagnostics = diagnostics;
	}

	/// Lazily decoded IR: version, origin, rules, layerOrder, keyframes,
	/// opaque, warnings.
	get version() {
		return this.#decodedIr().version;
	}

	get rules() {
		return this.#decodedIr().rules;
	}

	compute(nodes, parents, target, env) {
		return component.compute([this.handle], nodes, parents, target, env);
	}

	computeTree(nodes, parents, env) {
		return component.computeTree([this.handle], nodes, parents, env);
	}

	release() {
		if (this.handle != null) {
			component.release(this.handle);
			this.handle = null;
		}
	}

	[Symbol.dispose]() {
		this.release();
	}

	[Symbol.asyncDispose]() {
		this.release();
		return Promise.resolve();
	}

	#decodedIr() {
		return (this.#decoded ??= decodeIrBytes(this.ir));
	}

	#decoded = null;
}

export { Engine, createEngine } from './engine.js';

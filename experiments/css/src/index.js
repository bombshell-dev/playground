// @bomb.sh/css — bindings and runtime for the bombshell:css component.
//
// - `compiled` is the freestanding wasm module (brotli+Z85 embedded; the
//   module is decoded eagerly at import and ready for synchronous
//   instantiation). Regenerate with `node scripts/bundle-wasm.mjs`.
// - `component` is the instantiated engine exposing the raw ABI:
//   `compile`, `prepare`, `compute`, `computeTree`, `release`.
// - The ergonomic surface is top-level: `compile(css)` returns
//   `{ ir, diagnostics }`; `prepare(ir)` returns a `Sheet` whose
//   `compute`/`computeTree` methods carry the handle, and which releases
//   itself via `Symbol.dispose` (usable with `using`) or `Symbol.asyncDispose`
//   (`await using`), since release is synchronous.
//
// The embedded artifact decodes via `node:zlib`, so it targets Node-like
// runtimes; browser hosts load the raw module and use `loadCssComponent`.
import { compiled } from "./wasm.js";
import { loadCssComponentFromModule } from "./abi.js";
export { NO_PARENT, loadCssComponent, loadCssComponentFromModule, decodeIr } from "./abi.js";
export { compiled };

export const component = loadCssComponentFromModule(compiled);

export function compile(css, origin = 2) {
	return component.compile(css, origin);
}

export function prepare(ir) {
	return new Sheet(component.prepare(ir));
}

export function compute(sheet, nodes, parents, target, env) {
	return component.compute(handleOf(sheet), nodes, parents, target, env);
}

export function computeTree(sheet, nodes, parents, env) {
	return component.computeTree(handleOf(sheet), nodes, parents, env);
}

export function release(sheet) {
	if (sheet instanceof Sheet) {
		sheet.release();
	} else {
		component.release(sheet);
	}
}

function handleOf(sheet) {
	return sheet instanceof Sheet ? sheet.handle : sheet;
}

/// A prepared stylesheet. Wraps the raw handle so calls don't repeat it, and
/// releases itself at scope exit: `using sheet = prepare(ir)`.
export class Sheet {
	constructor(handle) {
		if (handle == null) {
			throw new TypeError("prepare rejected the IR");
		}
		this.handle = handle;
	}

	compute(nodes, parents, target, env) {
		return component.compute(this.handle, nodes, parents, target, env);
	}

	computeTree(nodes, parents, env) {
		return component.computeTree(this.handle, nodes, parents, env);
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
}

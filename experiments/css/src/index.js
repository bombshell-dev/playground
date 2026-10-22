// @bomb.sh/css — bindings and runtime for the bombshell:css component.
//
// - `compiled` is the freestanding wasm module (brotli+Z85 embedded; the
//   module is decoded eagerly at import and ready for synchronous
//   instantiation). Regenerate with `pnpm bundle <module.wasm>`.
// - `component` is the instantiated engine: `compile`, `prepare`, `compute`,
//   `computeTree`, `release` — the WIT world `bombshell:css@0.3.0`.
// - `loadCssComponent(bytes)` / `loadCssComponentFromModule(module)` for
//   hosts that ship their own artifact; `decodeIr` decodes the compiled
//   stylesheet IR for inspection.
//
// The embedded artifact decodes via `node:zlib`, so it targets Node-like
// runtimes; browser hosts load the raw module and use `loadCssComponent`.
import { compiled } from "./wasm.js";
import { loadCssComponentFromModule } from "./abi.js";
export { NO_PARENT, loadCssComponent, loadCssComponentFromModule, decodeIr } from "./abi.js";
export { compiled };

export const component = loadCssComponentFromModule(compiled);

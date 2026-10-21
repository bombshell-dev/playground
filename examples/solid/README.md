# Solid with @bomb.sh/dom

This example owns its framework adapter, framework dependencies, and acceptance tests. The core DOM package has no framework runtime dependencies. The adapter uses the public `@bomb.sh/dom` exports and the same tree and event implementation as ordinary DOM callers.

Run `pnpm --filter @bomb.sh/dom build`, then `pnpm --filter @examples/dom-solid test`, `pnpm --filter @examples/dom-solid typecheck`, or `pnpm --filter @examples/dom-solid demo`.

Solid uses its reactive browser export condition even in Node. Run Node with `--conditions=browser` (as the demo script does). The fixture also aliases the reactive export consistently for signals and the universal renderer. This does not install browser globals. Browser-compiled Solid output must instead be compiled for the universal adapter.

The tested scope covers mounting, native event handlers, text identity, asynchronous updates in independent documents, and cleanup. Browser styling, hydration, and framework-specific browser APIs are not implied. See [framework boundaries](../../packages/dom/docs/frameworks.md).

Solid’s upstream signal declarations import browser JSX types. This fixture loads the DOM type library locally to validate them without skipLibCheck; its host callbacks and mounted nodes use the actual `@bomb.sh/dom` types.

The tests call the real universal renderer with signals and node arrays. They do not compile browser JSX or exercise Solid’s web renderer. CSS style objects, raw markup, hydration, and SVG/MathML namespace propagation are unsupported. Disposal cleans the reactive owner and removes the rendered root.

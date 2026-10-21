# Crank with @bomb.sh/dom

This example owns its framework adapter, framework dependencies, and acceptance tests. The core DOM package has no framework runtime dependencies. The adapter uses the public `@bomb.sh/dom` exports and the same tree and event implementation as ordinary DOM callers.

Run `pnpm --filter @bomb.sh/dom build`, then `pnpm --filter @examples/dom-crank test`, `pnpm --filter @examples/dom-crank typecheck`, or `pnpm --filter @examples/dom-crank demo`.

The tested scope covers mounting, native event handlers, text identity, asynchronous updates in independent documents, and cleanup. Browser styling, hydration, and framework-specific browser APIs are not implied. See [framework boundaries](../../packages/dom/docs/frameworks.md).

Crank’s own context-event declarations reference browser event interfaces. This fixture includes the DOM type library locally so those upstream declarations can be checked; its adapter still accepts only `@bomb.sh/dom` nodes and never casts them to browser Node. No DOM library is added to the core or workspace configuration.

The generic Crank adapter exercises generator refreshes and generator cleanup. Raw HTML, hydration, and SVG/MathML namespace propagation are not implemented by this example. Native custom event props can use `on:ExactCase`; JSX-style built-in prop spellings are translated only in the adapter.

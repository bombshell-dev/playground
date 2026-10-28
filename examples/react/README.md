# React with @bomb.sh/dom

This example owns its framework adapter, framework dependencies, and acceptance tests. The core DOM package has no framework runtime dependencies. The adapter uses the public `@bomb.sh/dom` exports and the same tree and event implementation as ordinary DOM callers.

Run `pnpm --filter @bomb.sh/dom build`, then `pnpm --filter @examples/dom-react test`, `pnpm --filter @examples/dom-react typecheck`, or `pnpm --filter @examples/dom-react demo`.

The tested scope covers mounting, native event handlers, text identity, asynchronous updates in independent documents, and cleanup. Browser styling, hydration, and framework-specific browser APIs are not implied. See [framework boundaries](../../packages/dom/docs/frameworks.md).

This adapter uses React’s custom reconciler, not React DOM. It exposes native DOM events, without React’s synthetic event wrapper. Suspense/Activity hiding, hydration, CSS styles, resource hoisting, and browser form actions are unsupported. Render promises reject uncaught component errors; uncaught asynchronous state-update errors go to the document’s reportError hook. Namespace propagation for SVG/MathML is not implemented by this example.

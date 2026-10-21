# Preact with @bomb.sh/dom

This example owns its framework adapter, framework dependencies, and acceptance tests. The core DOM package has no framework runtime dependencies. The adapter uses the public `@bomb.sh/dom` exports and the same tree and event implementation as ordinary DOM callers.

Run `pnpm --filter @bomb.sh/dom build`, then `pnpm --filter @examples/dom-preact test`, `pnpm --filter @examples/dom-preact typecheck`, or `pnpm --filter @examples/dom-preact demo`.

The tested scope covers mounting, native event handlers, text identity, asynchronous updates in independent documents, and cleanup. Browser styling, hydration, and framework-specific browser APIs are not implied. See [framework boundaries](../../packages/dom/docs/frameworks.md).

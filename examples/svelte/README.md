# Svelte on the in-memory DOM

After building `@bomb.sh/dom`, run `pnpm --filter @examples/dom-svelte demo` or `pnpm --filter @examples/dom-svelte test`.

`src/Counter.svelte` is compiled by the real Svelte 5 client compiler. It uses a writable store, local reactive state, keyed each blocks, a delegated click listener, and mount/cleanup hooks. Tests exercise text and keyed-node identity, asynchronous updates in two documents, event delivery, and unmount cleanup.

Svelte's client runtime caches document/window and node prototype getters during initialization. The [persistent realm adapter](../dom-realm/README.md) bundles and instantiates a separate browser runtime per document. The host process never receives browser globals, and asynchronous callbacks keep their original document. Template parsing is explicitly installed by the adapter.

The `.svelte` component and its browser entry are compiler-validated JavaScript. Host tests and the realm adapter use the actual `@bomb.sh/dom` types. This demonstrates an explicit compilation/bootstrap boundary; it does not assert compatibility with full browser Element declarations or every Svelte feature. Hydration, CSS transitions/animation, layout, browser form defaults, and window navigation are outside this fixture's supported scope.

Svelte supplies its compiler and client reactivity/runtime; esbuild bundles that runtime for the persistent context. Both are dependencies of example packages, not the core DOM.

Sources: [Svelte mounting/unmounting API](https://svelte.dev/docs/svelte/imperative-component-api), [client DOM initialization](https://github.com/sveltejs/svelte/blob/main/packages/svelte/src/internal/client/dom/operations.js), [client mount implementation](https://github.com/sveltejs/svelte/blob/main/packages/svelte/src/internal/client/render.js).

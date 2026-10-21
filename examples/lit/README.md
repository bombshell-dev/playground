# Lit on the in-memory DOM

After building `@bomb.sh/dom`, run `pnpm --filter @examples/dom-lit demo` or `pnpm --filter @examples/dom-lit test`.

`src/component.js` is a real Lit 3 custom element using reactive properties, reflected attributes, a click listener, a shadow root, and a slot. There are no decorators. The tests cover asynchronous property/attribute updates, native event dispatch, lifecycle callbacks, reconnection identity, slot composition, and concurrent independent documents.

Lit captures its HTMLElement constructor and template-creation document during module evaluation. The example loads Lit's browser implementation into the [persistent realm adapter](../dom-realm/README.md) once per document. Subsequent asynchronous updates keep that document without swapping globals. The package's ordinary Node/SSR entry is not used for acceptance.

This demonstrates the tested interactive subset. Browser CSS rendering, hydration, adopted stylesheets, and arbitrary browser APIs are not supplied. Framework component source is JavaScript; the adapter and host tests use the real public `@bomb.sh/dom` TypeScript declarations without claiming a complete browser HTMLElement.

Lit is a dependency of this example only. See [Lit's lifecycle documentation](https://lit.dev/docs/components/lifecycle/) and [browser/Node entry implementations](https://github.com/lit/lit/tree/main/packages).

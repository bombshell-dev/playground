# Framework boundaries

The package never installs a process-wide `document`, `window`, or DOM constructors. Every root must have an explicit document identity that remains valid during asynchronous updates. An integration adapter is a supported boundary only for the behavior exercised by its tests; it does not imply compatibility with every browser renderer feature.

| Framework | Inspected version          | Integration boundary                                                                                                                                                 |
| --------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preact    | 11.0.1                     | Actual `preact.render` and `createPortal`, with this package's Element satisfying public `ContainerNode` structurally.                                               |
| React     | 19.3.1 / reconciler 0.34.0 | Official custom reconciler host configuration; React DOM's browser container declaration is not asserted onto our elements.                                          |
| Solid     | 1.9.17                     | Official `solid-js/universal` generic renderer, bound to an explicit document.                                                                                       |
| Lit       | 3.3.3                      | Persistent realm/bootstrap boundary needed for constructors and template creation. Depends on tested custom elements, templates, ranges/traversal, and shadow roots. |
| Svelte    | 5.57.2                     | Client runtime captures global window/document and node prototype getters; requires an isolated persistent runtime realm or a substantive compiler/runtime adapter.  |
| Crank     | 0.7.12                     | Generic `Renderer<Node, …>` adapter gives accurate host types; browser DOMRenderer declarations alone are not compatible.                                            |

## Preact

The pinned renderer gets the node-creation document from `parentDom.ownerDocument` each time it creates a node. Portals supply their own parent container. This works across concurrently updated roots without ambient global swapping. `examples/preact/src/index.ts` is a small root-lifecycle facade over the actual renderer; it is not a mock renderer.

Preact's own JSX mapping converts `onKeyDown` into the native event name `keydown`. A prop such as `onionChange` retains `ionChange`. The underlying DOM preserves event-name case. Events remain extensible so Preact can add its per-renderer dispatch bookkeeping symbol.

The example-local `@examples/dom-preact/jsx-runtime` facade describes our actual host refs and events. JSX configuration belongs in an application or fixture tsconfig. The core package and workspace do not enable JSX or browser DOM declarations globally.

Sources: [Preact render and public types](https://github.com/preactjs/preact/tree/11.0.1/src), particularly `diff/index.js`, `diff/props.js`, `create-portal.js`, and `index.d.ts`.

## React and Solid

React's official reconciler supports a host configuration with our existing nodes. This supplies real React scheduling, reconciliation, refs, and effects without declaring that our elements implement every browser Node member. Events are native host listeners rather than React DOM's synthetic event system. CSS, hydration, browser form behavior, Suspense/Activity hiding, and React DOM-specific APIs are unsupported by this example. Namespace propagation for SVG/MathML is not implemented in the React/Solid/Crank adapters.

Solid's official universal renderer takes explicit creation, insertion, property, text, and traversal operations. Its browser/web renderer is a different integration and expects browser globals. Universal compilation must target the adapter; ordinary browser-compiled Solid output is not interchangeable. Node's default Solid export condition is server-oriented, so acceptance fixtures must deliberately select the reactive client implementation consistently for both signals and universal renderer imports.

Sources: [React custom renderers](https://github.com/facebook/react/tree/main/packages/react-reconciler), [Solid universal renderer](https://github.com/solidjs/solid/tree/main/packages/solid/universal).

## Lit and Svelte

Lit modules choose an HTMLElement constructor and a document during bootstrap. Its Node export can use an SSR shim, which does not prove browser-side interactive rendering support. An adapter must load the browser implementation in a stable environment whose constructors and document belong to the target DOM, then test asynchronous updates after bootstrap. Temporary global replacement around `render()` is unsafe.

Svelte 5.57.2 `src/internal/client/dom/operations.js` caches `window`, `document`, and prototype accessors in `init_operations`. Later creation helpers still reference document, and its event delegation installs listeners on the container and document. Therefore a single shared browser runtime cannot be made document-independent by changing a global only while mounting. A persistent isolated realm must have its own module instance and globals, with no worker or browser runtime dependency. The checked-in examples/dom-realm boundary instantiates a persistent browser bundle per document; the Svelte acceptance tests exercise async updates in two independent documents.

Sources: [Lit source](https://github.com/lit/lit/tree/main/packages), [Svelte DOM operations](https://github.com/sveltejs/svelte/blob/main/packages/svelte/src/internal/client/dom/operations.js), [Svelte mounting](https://github.com/sveltejs/svelte/blob/main/packages/svelte/src/internal/client/render.js).

## Crank

The inspected DOM renderer already derives its document from a root or root.ownerDocument and uses nodeType constants without installing Node/Element globals. However, its public DOMRenderer signature uses complete browser Node types. A generic renderer adapter keeps its declarations faithful to this package and uses the same mutation implementation as every other integration.

Source: [Crank renderer implementation](https://github.com/bikeshaving/crank/tree/main/src).

## Dependency policy

Frameworks and their reconciler packages are dependencies of the separate `examples/preact`, `examples/react`, `examples/solid`, `examples/lit`, `examples/svelte`, and `examples/crank` workspace packages. The core does not depend on or export integrations. Preact provides reconciliation/hooks; React plus react-reconciler provide React scheduling and host reconciliation; Solid provides reactive scopes and universal reconciliation; Crank provides generator component reconciliation. None supplies a second DOM tree. Development dependencies provide TypeScript declaration checking, Vitest, and playground formatting/lint/build tools.

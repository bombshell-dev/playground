# Persistent framework fixture realms

This private example package supplies the explicit bootstrap boundary used by the Lit and Svelte examples. Each `FixtureRealm` receives an existing `@bomb.sh/dom` document and creates a persistent Node `vm` context. The context exposes that document's custom-element registry and HTMLElement constructor, the actual DOM node/event constructors, a window event target, timers, and microtasks. Parsing is explicitly installed for template creation.

`bundleFixture()` uses esbuild's browser export condition and bundles the framework together with the example entry. Running that bundle separately in each context gives every document its own framework module state. Promises and callbacks retain their original context during later updates. Nothing installs or swaps the host process's `document`, `window`, or constructors.

The context uses the same DOM nodes as the host; it creates no second tree. It is a bootstrap example for trusted local modules, not an untrusted-code sandbox, browser API implementation, or script execution facility exported by the DOM package. It does not supply layout, stylesheet rendering, navigation, networking, or browser default input actions.

The adapter's TypeScript API accepts the package's actual `Document`, and code evaluation returns `unknown`. Framework browser modules are bundled JavaScript. This boundary does not claim that the package's public types structurally implement the complete browser `HTMLElement` expected by Lit or Svelte declarations.

Dependencies: `@bomb.sh/dom` provides the one tree; esbuild selects and bundles the browser framework modules; Node's built-in `vm` retains their separate lexical environments. No worker, browser process, CommonJS output, or framework code is added to the core package.

See [Node VM contexts](https://nodejs.org/api/vm.html#vmcreatecontextcontextobject-options). The DOM `window` facade here is deliberately limited to the capabilities exposed in `src/index.ts`.

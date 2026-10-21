# @bomb.sh/dom

A lightweight, headless, in-memory DOM for interactive applications. Documents own their trees, focus, selection, and custom-element registries. Importing the package installs no globals. Terminal rendering, layout, input decoding, frame scheduling, and output backpressure belong to consumers.

This is an independently maintained implementation with a tested subset of DOM and HTML behavior. See the [capability matrix](docs/capabilities.md) for supported scope and unfinished work, and [provenance](docs/provenance.md) for the pinned references, licenses, and baseline differences.

## Construct and observe a document

```ts
import { Document, MutationObserver } from '@bomb.sh/dom';

const document = new Document({
	onInvalidate(change) {
		// Ask your renderer for a frame; coalesce and handle backpressure there.
		console.info(change.kind); // mutation, focus, or selection
	},
	reportError(error) {
		console.error(error); // Listener / custom-element callback exceptions
	},
});
const root = document.createElement('box');
const label = document.createElement('text');
label.textContent = 'Ready';
root.append(label); // Detached preparation requests no frame.
document.append(root); // Explicit shape: use "document" here for a Clack adapter.

const observer = new MutationObserver((records) => {
	console.info(records.map((record) => record.type));
});
observer.observe(label, { childList: true, characterData: true, subtree: true });
label.firstChild!.textContent = 'Running';
// Observer records are delivered in a microtask, independently of repainting.
// Explicitly observing a detached node works too.
```

Documents start empty. `documentElement` is nullable. Append one root element; document fragments allow detached preparation. Nodes move on insertion and are adopted when moved across documents. Child, element, and attribute collections are live read-only array views; mutation goes through node/attribute methods.

## Events and host input

```ts
import { Event, Dispatch } from '@bomb.sh/dom';

root.addEventListener(
	'activate',
	(event) => {
		event.preventDefault();
	},
	{ capture: true },
);
const accepted = label.dispatchEvent(
	new Event('activate', {
		bubbles: true,
		cancelable: true,
	}),
); // false

const input = document.createElement('input');
const next = document.createElement('button');
root.append(input, next);
input.focus();
const dispatch = new Dispatch(document); // document.dispatch is also available.
dispatch.keydown({ key: 'Tab' }); // Route to focus, then navigate if uncanceled.
dispatch.keyup({ key: 'Tab' });
```

Event names preserve case. Capture, target, bubbling, cancellation, listener snapshots, once/passive/signal options, listener objects, and shadow retargeting are exercised by unit tests and selected upstream WPT cases. Listener exceptions are reported without escaping dispatch. The default error reporter queues an uncaught exception; hosts can provide `reportError`.

`element.dispatchEvent()` delivers a synthetic event. Synthetic keyboard and focus events do not run host input actions. Following HTML activation semantics, an uncanceled `MouseEvent("click")` can activate controls; `element.click()` provides that operation. `Dispatch` is the explicit host-input boundary for logical navigation, text editing, keyboard activation and option selection; all generated events remain untrusted. See [focus and controls](docs/focus-and-controls.md).

## Two independent selection systems

```ts
input.value = 'a😀b';
input.setSelectionRange(1, 3, 'forward'); // UTF-16 code units
input.setRangeText('x', 1, 3, 'select');

const range = document.createRange();
range.selectNodeContents(label);
document.getSelection().addRange(range);
console.info(document.getSelection().toString());
```

Ranges adjust when text or the tree changes. Element offsets count child nodes. These APIs do not measure graphemes, terminal columns, or coordinates. See [selection and observation](docs/selection-observation.md) for the exact API subset.

## Custom elements and opt-in parsing

```ts
import { installParsing } from '@bomb.sh/dom/parsing';
installParsing(document);

class PromptLabel extends document.HTMLElement {
	connectedCallback(): void {
		if (!this.shadowRoot) {
			this.attachShadow({ mode: 'open' }).innerHTML = '<text><slot></slot></text>';
		}
	}
}
document.customElements.define('prompt-label', PromptLabel);
const prompt = document.createElement('prompt-label');
prompt.append('Continue?');
root.append(prompt);
```

Each environment has an explicit `document.HTMLElement` base and registry. Autonomous custom elements support direct construction and identity-preserving upgrades, observed attributes, connection/disconnection/adoption callbacks, and reentrancy. Parsing is opt-in; scripts remain inert. Template contents are separate, inert trees. Shadow roots and slots compose events and focus without a rendering engine.

`parse5` is the only production dependency. The separate `@bomb.sh/dom/parsing` entry uses its HTML tokenizer/tree builder, then creates nodes in this implementation. The core entry does not load it. No LinkeDOM runtime, second DOM hierarchy, framework, browser process, or worker is required.

## Interactive HTML and terminal elements

Forms, buttons, labels, fieldsets, inputs, textareas, selects/options, output,
progress/meter, details/summary and dialogs have specialized classes and tested
state transitions. See [forms and element extensions](docs/forms-and-elements.md)
for examples and limits, and [interactive standards](docs/interactive-standards.md)
for browser comparisons and known differences.

Arbitrary names still work without registration. To give a terminal element
application behavior, register its factory explicitly on each document:

```ts
import { Document, Element } from '@bomb.sh/dom';

class Box extends Element {
	constructor(document: Document) {
		super('box', document);
	}
	status = 'ready';
}
declare module '@bomb.sh/dom' {
	interface Elements {
		box: Box;
	}
}
document.registerElement('box', (owner) => new Box(owner));
document.createElement('box').status; // string, with a real Box instance
```

Declaration merging is a TypeScript contract: install the factory in every
application document that relies on that declaration. Registration affects future
creation, cloning and parsing; it does not upgrade existing nodes. Hyphenated
custom elements use `document.customElements` and its lifecycle model.

## Framework examples

Integration code, framework dependencies, JSX settings, demos, and acceptance tests live in separate workspace packages:

| Example                                      | Boundary                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| [Preact 11](../../examples/preact/README.md) | Actual `render`/portals using container ownership; local typed JSX facade.      |
| [React](../../examples/react/README.md)      | Official custom reconciler and native host events.                              |
| [Solid](../../examples/solid/README.md)      | Official generic universal renderer.                                            |
| [Lit](../../examples/lit/README.md)          | Browser Lit runtime in a persistent document-specific Node VM context.          |
| [Svelte](../../examples/svelte/README.md)    | Real client compiler/runtime in a persistent document-specific Node VM context. |
| [Crank](../../examples/crank/README.md)      | Generic renderer with the package's real node types.                            |

The [realm example](../../examples/dom-realm/README.md) explains Lit/Svelte bootstrap. It keeps asynchronous work bound to its original document without swapping process globals. VM execution and fixture bundling are example facilities, outside the DOM package. See [framework boundaries](docs/frameworks.md) for limitations.

## Development

From the playground root:

```sh
pnpm install
pnpm --filter @bomb.sh/dom build
pnpm --filter @bomb.sh/dom typecheck
pnpm --filter @bomb.sh/dom exec vitest run
pnpm --filter '@examples/dom-*' typecheck
pnpm --filter '@examples/dom-*' --if-present test
pnpm --filter @bomb.sh/dom format:check
pnpm --filter @bomb.sh/dom lint
pnpm --filter @examples/dom-preact demo
```

The package emits ESM JavaScript, declaration files, and maps through the playground's TypeScript compiler. Core checking uses strict TypeScript without the browser DOM library. JSX and upstream browser declaration requirements stay local to examples. No publishing is performed by these commands.

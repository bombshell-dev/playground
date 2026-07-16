# @bomb.sh/dom

Headless component tree with DOM-style event propagation. Zero dependencies.

`@bomb.sh/dom` is a headless interaction tree for TUIs, stated entirely in the
platform's vocabulary. Nodes **are** `EventTarget`s; the tree API is
document-shaped (`createElement`/`append`/`insertBefore`, attributes,
`getElementById`, `tabindex`); events route by capture/target/bubble
propagation; a `change` event on the root signals "re-render". If you know the
DOM, you already know this package.

## The question this package answers

> Can we just leverage `EventTarget` on the nodes to manage bubbling?

**Yes.** Node's native `EventTarget` provides listener storage, error
isolation, and the full `Event` flag machinery (`stopPropagation`,
`stopImmediatePropagation`, `preventDefault`, `once`, `signal`). What it lacks
is a tree — `dispatchEvent` invokes every listener on a single target as if
`AT_TARGET`. `PropagationTarget` (see `src/lib/events.ts`) adds the tree walk
on top, and empirically that needs exactly two shims:

1. **Identity.** Each per-node native dispatch resets `event.target` to that
   node, so the real target, phase, and path are pinned as own properties on
   the event instance, shadowing the prototype getters. `currentTarget` needs
   no shim — native dispatch sets it correctly per node, and nulls it after.
2. **Phase filtering.** A bare `EventTarget` fires `{capture: true}` listeners
   on every dispatch, so listeners register through a thin wrapper that
   consults the pinned phase. The wrapper also owns `once`/`signal`, because a
   native `once` would consume a listener whose phase never matched.

Between per-node dispatches, `event.cancelBubble` (the legacy readable alias
for the stop-propagation flag) tells the walk when to halt. One divergence
from the DOM: the flag can't be cleared from the outside, so a stopped event
can't be re-dispatched — `dispatchEvent` throws and asks for a fresh event.

## The IR question

> Can we avoid an IR / VDOM that we normalize to ops?

**Yes — retained interaction tree, immediate-mode render.** This package's tree is
_not_ a render tree and never normalizes to ops. It holds interaction state
(focus, values, event listeners); rendering stays a pure function that walks
the tree and produces `Op[]` fresh each frame — components are functions
returning ops. The bridge between the two worlds is one string: `node.id`
becomes the renderer's element key, so element identity in the renderer
follows node identity in the interaction tree for free. No reconciliation, no
diffing, no ops in this package.

```ts
// compose with an op-based renderer (e.g. @bomb.sh/tty): read state, return ops
function textInput(node: Node): Op[] {
	return [
		open(node.id, { border: node.states.has('focus') ? focusedBorder : border }),
		text(String(node.getAttribute('value') ?? '')),
		close(),
	];
}
root.addEventListener('change', () => render(textInput(input)));
```

## The tree: document-shaped

Creation is separate from insertion, like the DOM — and insertion doubles as
reordering:

- `root.createElement(localName)` returns a **detached** node; `parent.append(...nodes)`
  and `parent.insertBefore(node, reference)` attach it. Detached nodes are not
  resolvable via `root.getElementById` (connected-only, like the DOM).
- Inserting an **already-attached** node moves it, state-preservingly: no
  signal abort, no lifecycle events, listeners intact. This is the DOM's new
  `moveBefore()` semantics applied to all insertions — reordering is
  re-insertion, not a separate API.
- State is **attributes**: `getAttribute`/`setAttribute`/`hasAttribute`/
  `removeAttribute`, with a frozen `node.attributes` snapshot for renderers.
  Focusability is literally `setAttribute('tabindex', 0)`.
- Derived pseudo-class flags live in **`node.states`** (`'focus'`,
  `'focus-within'`) — the `ElementInternals.states` analog. Managers write
  them, renderers read them; the attribute namespace stays author-owned.

Deliberate divergences, documented rather than hidden: attribute values are
JsonValue (renderers need structure; the DOM's string-only rule buys nothing
headless), `getAttribute` returns `undefined` for missing attributes (`null`
is a legal value here), and `remove()` is **terminal** — it destroys the
subtree and aborts `node.signal`. The DOM's detached-but-alive limbo exists
for GC and adoption; a TUI tree doesn't need it, and the entire `node.signal`
lifetime story depends on removal being final. Moves cover the legitimate
reason to detach-and-reattach.

## Node lifetime: `node.signal`

Every node owns an `AbortSignal` that aborts when the node is removed (or the
root destroyed), descendants first, in reverse creation order. Hand it to
anything whose lifetime should match the node's:

```ts
// a listener installed on an ancestor, cleaned up when the node dies
root.documentElement.addEventListener('keydown', onKey, { signal: node.signal });

// a spinner that stops when its node is removed — no manual cleanup
import { setTimeout as delay } from 'node:timers/promises';

async function spin(node: Node): Promise<void> {
	const frames = ['⠋', '⠙', '⠹', '⠸'];
	try {
		for (let i = 0; ; i++) {
			node.setAttribute('frame', frames[i % frames.length]!);
			await delay(80, undefined, { signal: node.signal });
		}
	} catch {
		// aborted — the node was removed
	}
}
```

The same signal flows into `fetch`, `node:timers/promises`, streams, and
this package's own `addEventListener` — one primitive, already understood by
every web developer. One caveat: cancellation is **cooperative** — an async
function keeps running past its awaits unless the awaited thing honors the
signal (platform APIs do; arbitrary user code may not). `FocusManager`
dogfoods the signal: its bookkeeping is registered with
`{ signal: root.signal }` and disappears with its container.

## Focus: `FocusManager` and `focusgroup`

Focus is structured the way the DOM structures it — authoritative state held
by an owner, not a property scanned for:

- **Focusability is `tabindex`**, like the DOM: `setAttribute('tabindex', 0)`
  joins sequential traversal; `-1` is focusable only via `focus()`. Transitions
  project into `node.states`: `'focus'` on the active node, `'focus-within'`
  up its ancestor chain — the pseudo-classes renderers match on, minus the
  colon.
- **`FocusManager`** is the `document.activeElement` analog: an O(1) pointer,
  `focus()`, and sequential `next()`/`previous()` (Tab) traversal. Focus
  changes fire `blur`/`focusout` at the old node and `focus`/`focusin` at the
  new — `focus`/`blur` don't bubble, `focusin`/`focusout` do, and all four
  carry `relatedTarget`, matching the browser.
- **`focusgroup`** implements the
  [Open UI scoped focusgroup explainer](https://open-ui.org/components/scoped-focusgroup.explainer/)
  (shipped in Chrome 150) as an attribute with the same token grammar:
  `'toolbar'`, `'tablist'`, `'listbox nomemory'`, `'menu wrap'`, …
  The attribute alone is honored declaratively by `FocusManager`: a group
  collapses to a single tab stop, entered at the last-focused item (memory) or
  its first item — the explainer's guaranteed tab stop algorithm. `'none'`
  opts a subtree out; nested groups are independent segments.
- **`FocusGroupManager`** is the imperative half — arrow-key traversal
  (`next`/`previous`/`first`/`last`) within one group, axis metadata for key
  binding, and memory tracking via the bubbling `focusin` event. Its methods
  no-op while focus is outside the group, so arrows can be bound globally.

```ts
const focus = new FocusManager(root.documentElement);
const tabs = new FocusGroupManager(focus, tabBar, 'tablist'); // inline, wrap, memory

// Tab collapses the group to one stop; arrows move within it
if (code === 'Tab') focus.next();
if (code === 'ArrowRight') tabs.next();
if (code === 'ArrowLeft') tabs.previous();
```

Simplifications vs the explainer, on purpose: no `focusgroupstart`, no grid
tokens, and an opted-out element doesn't split the group into separate
tab-stop segments — it just becomes its own stop.

## Sketch

```ts
import { createRoot, FocusManager } from '@bomb.sh/dom';

const root = createRoot();
const input = root.createElement('input');
root.documentElement.append(input);
input.setAttribute('tabindex', 0);
input.setAttribute('value', '');

input.addEventListener('keydown', (event) => {
	const { key } = (event as KeyEvent).detail;
	if (key.length === 1) {
		input.setAttribute('value', `${input.getAttribute('value')}${key}`);
		event.stopPropagation(); // consumed — root never sees it
	}
});

const focus = new FocusManager(root.documentElement);

root.documentElement.addEventListener('keydown', (event) => {
	if ((event as KeyEvent).detail.code === 'Tab') focus.next(); // bubbled here
});

root.addEventListener('change', render);

// all the input routing there is: dispatch at the focused node
focus.activeElement.dispatchEvent(new KeyEvent(raw));
```

Run the demo:

```sh
pnpm playground -e focus
```

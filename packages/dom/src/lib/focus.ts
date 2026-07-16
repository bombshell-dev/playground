// oxlint-disable bombshell-dev/no-generic-error
// oxlint-disable max-params

// DOM-shaped focus: authoritative state held by an owner, not derived by
// scanning the tree on every query — the way the platform does it:
//
// - Focusability is the `tabindex` attribute, like the DOM: `0` (or any
//   non-negative number) joins sequential traversal; `-1` is focusable only
//   programmatically. The manager projects transitions into `node.states` for
//   renderers: `'focus'` on the active node, `'focus-within'` on its ancestor
//   chain — the pseudo-classes, minus the colon. Attributes stay author-owned.
// - `FocusManager` is `document`'s focus machinery: an `activeElement` pointer,
//   `focus()`, and sequential (Tab) traversal.
// - `focusgroup` is an attribute on a container using the Open UI
//   scoped-focusgroup token grammar (`'toolbar'`, `'tablist wrap'`,
//   `'listbox nomemory'`, ...) — "the explainer" below:
//   https://open-ui.org/components/scoped-focusgroup.explainer/
//   FocusManager honors it declaratively:
//   a group collapses to a single tab stop (entry = last-focused memory, else
//   first item), exactly like the explainer's guaranteed tab stop algorithm.
// - `FocusGroupManager` is the imperative side of the attribute: arrow-key
//   traversal (`next`/`previous`/`first`/`last`) within the group, plus memory
//   tracking via a bubbling `focusin` listener.
//
// Simplifications vs the explainer, on purpose: no `focusgroupstart`, no grid
// tokens, and an opted-out (`'none'`) element does not split the group into
// separate tab-stop segments — it just becomes its own stop.
import type { Node } from './types.ts';
import { createNodeData } from './types.ts';

export type FocusEventType = 'focus' | 'blur' | 'focusin' | 'focusout';

// DOM FocusEvent: `relatedTarget` is the other side of the transition — where
// focus is going (blur/focusout) or where it came from (focus/focusin).
// Like the DOM, focus/blur do not bubble; focusin/focusout do.
export class FocusEvent extends Event {
	constructor(
		type: FocusEventType,
		readonly relatedTarget: Node | undefined,
	) {
		super(type, { bubbles: type === 'focusin' || type === 'focusout' });
	}
}

// In sequential (Tab/arrow) traversal, like tabindex="0" in the DOM.
function isSequentiallyFocusable(node: Node): boolean {
	const tabindex = node.getAttribute('tabindex');
	return typeof tabindex === 'number' && tabindex >= 0;
}

// Focusable at all — includes tabindex="-1" (programmatic focus only).
function isFocusable(node: Node): boolean {
	return typeof node.getAttribute('tabindex') === 'number';
}

// ---------------------------------------------------------------------------
// focusgroup token grammar (Open UI scoped focusgroup)

export interface FocusGroupConfig {
	behavior?: 'toolbar' | 'tablist' | 'radiogroup' | 'listbox' | 'menu' | 'menubar';
	axis: 'inline' | 'block' | 'both';
	wrap: boolean;
	memory: boolean;
}

const BEHAVIORS: Record<string, Pick<FocusGroupConfig, 'axis' | 'wrap'>> = {
	toolbar: { axis: 'inline', wrap: false },
	tablist: { axis: 'inline', wrap: true },
	radiogroup: { axis: 'both', wrap: true },
	listbox: { axis: 'block', wrap: false },
	menu: { axis: 'block', wrap: true },
	menubar: { axis: 'inline', wrap: true },
};

// Token strings are parsed on every stop computation (i.e., every Tab), so
// results are memoized by the exact attribute string. The set of distinct
// focusgroup values in an app is tiny; the map is effectively bounded.
const parsed = new Map<string, FocusGroupConfig>();

export function parseFocusgroup(value: string): FocusGroupConfig {
	const cached = parsed.get(value);
	if (cached) {
		return cached;
	}
	const tokens = value.split(/\s+/).filter(Boolean);
	const behavior = tokens.find((t) => t in BEHAVIORS) as FocusGroupConfig['behavior'];
	const base = behavior ? BEHAVIORS[behavior as string]! : { axis: 'both' as const, wrap: false };
	const axis = tokens.includes('inline')
		? 'inline'
		: tokens.includes('block')
			? 'block'
			: base.axis;
	const wrap = tokens.includes('wrap') ? true : tokens.includes('nowrap') ? false : base.wrap;
	const config: FocusGroupConfig = Object.freeze({
		behavior,
		axis,
		wrap,
		memory: !tokens.includes('nomemory'),
	});
	parsed.set(value, config);
	return config;
}

const noneCache = new Map<string, boolean>();

function hasNoneToken(value: string): boolean {
	let none = noneCache.get(value);
	if (none === undefined) {
		none = value.split(/\s+/).includes('none');
		noneCache.set(value, none);
	}
	return none;
}

// A node declares a group when its `focusgroup` attribute is a non-`none`
// string.
function groupValue(node: Node): string | undefined {
	const value = node.getAttribute('focusgroup');
	if (typeof value !== 'string') {
		return undefined;
	}
	return hasNoneToken(value) ? undefined : value;
}

function optsOut(node: Node): boolean {
	const value = node.getAttribute('focusgroup');
	return typeof value === 'string' && hasNoneToken(value);
}

// The segment a node's tab stop collapses into: the nearest ancestor-or-self
// declaring a group, stopping at opt-outs (a `none` subtree is independent of
// every enclosing group) and at the traversal root. Nearest wins, so an item
// in a nested group belongs to the nested segment, not the outer one.
function segmentOf(node: Node, root: Node): Node | undefined {
	for (let n: Node | undefined = node; n && n !== root; n = n.parent) {
		if (groupValue(n) !== undefined) {
			return n;
		}
		if (optsOut(n)) {
			return undefined;
		}
	}
	return undefined;
}

// Last-focused item per group container — the explainer's focus memory.
// Private to this module; validity is checked at read time via `node.signal`.
const memoryKey = createNodeData<Node | undefined>('focus:memory');

// Items of a group segment: the container (if focusable) and its focusable
// descendants, excluding subtrees that opt out (`none`) or declare their own
// nested group (independent segments per the explainer).
function segmentItems(group: Node): Node[] {
	const items: Node[] = [];
	const walk = (node: Node): void => {
		if (node !== group && typeof node.getAttribute('focusgroup') === 'string') {
			return;
		}
		if (isSequentiallyFocusable(node)) {
			items.push(node);
		}
		for (const child of node.children) {
			walk(child);
		}
	};
	walk(group);
	return items;
}

// Every sequentially focusable node in tree order, groups flattened — used for
// removal successors, where "next focusable thing" matters more than tab stops.
function flatFocusables(root: Node): Node[] {
	const result: Node[] = [];
	const walk = (node: Node): void => {
		if (isSequentiallyFocusable(node)) {
			result.push(node);
		}
		for (const child of node.children) {
			walk(child);
		}
	};
	walk(root);
	return result;
}

// ---------------------------------------------------------------------------

interface TabStop {
	stop: Node;
	// Set when this stop is the collapsed entry of a focusgroup segment.
	segment: Node | undefined;
}

// The `document.activeElement` analog: authoritative focus state for a subtree,
// with sequential (Tab) traversal that honors declarative `focusgroup` props.
// Construct one per root (or per container for a nested focus scope); its
// bookkeeping is registered with `{ signal: root.signal }` and dies with it.
export class FocusManager {
	#active: Node | undefined;

	constructor(readonly root: Node) {
		const seed = this.#stops().find(({ stop }) => stop !== root);
		if (seed) {
			this.focus(seed.stop);
		}
		// Dispatched before detach, so successor computation sees the full tree.
		root.addEventListener('remove', (event) => this.#onRemove(event.target as Node), {
			signal: root.signal,
		});
	}

	// Never null: falls back to the root, like document.activeElement's body
	// fallback.
	get activeElement(): Node {
		return this.#active ?? this.root;
	}

	// Accepts any node with a tabindex, including -1 (programmatic focus, like
	// the DOM). Sequential traversal only visits tabindex >= 0.
	focus(node: Node): void {
		if (!isFocusable(node)) {
			throw new Error('Cannot focus a node without a tabindex attribute');
		}
		if (node === this.#active) {
			return;
		}
		const old = this.#active;
		if (old) {
			this.#clearStates(old);
			old.dispatchEvent(new FocusEvent('blur', node));
			old.dispatchEvent(new FocusEvent('focusout', node));
		}
		this.#active = node;
		node.states.add('focus');
		for (let n: Node | undefined = node; n; n = n.parent) {
			n.states.add('focus-within');
		}
		node.dispatchEvent(new FocusEvent('focus', old));
		node.dispatchEvent(new FocusEvent('focusin', old));
	}

	#clearStates(node: Node): void {
		node.states.delete('focus');
		for (let n: Node | undefined = node; n; n = n.parent) {
			n.states.delete('focus-within');
		}
	}

	next(): void {
		this.#move(1);
	}

	previous(): void {
		this.#move(-1);
	}

	// Tab stops in tree order: plain focusables, plus one collapsed stop per
	// focusgroup segment (the explainer's guaranteed tab stop algorithm).
	#stops(): TabStop[] {
		const result: TabStop[] = [];
		const walk = (node: Node, group: Node | undefined): void => {
			let next = group;
			const value = groupValue(node);
			if (value !== undefined && node !== this.root) {
				const entry = this.#entryOf(node, value);
				if (entry) {
					result.push({ stop: entry, segment: node });
				}
				next = node;
			} else if (optsOut(node)) {
				// Opted out of the enclosing group: independently tabbable.
				next = undefined;
				if (isSequentiallyFocusable(node)) {
					result.push({ stop: node, segment: undefined });
				}
			} else if (!group && isSequentiallyFocusable(node)) {
				result.push({ stop: node, segment: undefined });
			}
			for (const child of node.children) {
				walk(child, next);
			}
		};
		walk(this.root, undefined);
		return result;
	}

	// Where Tab lands when entering a group: memory if alive and valid, else
	// the segment's first item.
	#entryOf(group: Node, value: string): Node | undefined {
		if (parseFocusgroup(value).memory) {
			const memory = group.data.get(memoryKey);
			if (
				memory &&
				!memory.signal.aborted &&
				isSequentiallyFocusable(memory) &&
				group.contains(memory)
			) {
				return memory;
			}
		}
		return segmentItems(group)[0];
	}

	#move(delta: number): void {
		const stops = this.#stops();
		if (stops.length === 0) {
			return;
		}
		const active = this.#active;
		let idx = -1;
		if (active) {
			const segment = segmentOf(active, this.root);
			idx = segment
				? stops.findIndex((s) => s.segment === segment)
				: stops.findIndex((s) => s.stop === active);
		}
		if (idx === -1) {
			this.focus(delta > 0 ? stops[0]!.stop : stops[stops.length - 1]!.stop);
			return;
		}
		if (stops.length === 1) {
			return;
		}
		this.focus(stops[(idx + delta + stops.length) % stops.length]!.stop);
	}

	#onRemove(removed: Node): void {
		const active = this.#active;
		if (!active || !removed.contains(active)) {
			return;
		}
		const chain = flatFocusables(this.root);
		const start = chain.indexOf(active);
		for (let i = 1; i < chain.length; i++) {
			const candidate = chain[(start + i + chain.length) % chain.length]!;
			if (!removed.contains(candidate)) {
				this.focus(candidate);
				return;
			}
		}
		// No successor: clear states while the removed chain is still attached
		// (this listener runs before detach), so surviving ancestors drop
		// `focus-within`.
		this.#clearStates(active);
		this.#active = undefined;
	}
}

// The imperative half of the `focusgroup` attribute: arrow-key traversal within
// one group. Declares the group by writing the token string to the container's
// `focusgroup` attribute (renderer-visible, exactly like the DOM) and tracks
// focus memory via the bubbling `focusin` event.
export class FocusGroupManager {
	readonly config: FocusGroupConfig;
	#controller = new AbortController();

	constructor(
		readonly focus: FocusManager,
		readonly container: Node,
		tokens = '',
	) {
		this.config = parseFocusgroup(tokens);
		container.setAttribute('focusgroup', tokens);
		container.addEventListener(
			'focusin',
			(event) => {
				const target = event.target as Node;
				if (this.config.memory && this.items.includes(target)) {
					container.data.set(memoryKey, target);
				}
			},
			{ signal: AbortSignal.any([container.signal, this.#controller.signal]) },
		);
	}

	// Advisory for key binding: which arrow keys the app should route here
	// (headless code has no keyboard; the explainer's axis is a key concern).
	get axis(): FocusGroupConfig['axis'] {
		return this.config.axis;
	}

	get items(): Node[] {
		return segmentItems(this.container);
	}

	// Arrow-key traversal only acts while focus is inside the group, like the
	// DOM behavior — so apps can bind arrows globally and let the group no-op.
	next(): void {
		this.#move(1);
	}

	previous(): void {
		this.#move(-1);
	}

	first(): void {
		const items = this.items;
		if (items.length > 0 && this.#index(items) !== -1) {
			this.focus.focus(items[0]!);
		}
	}

	last(): void {
		const items = this.items;
		if (items.length > 0 && this.#index(items) !== -1) {
			this.focus.focus(items[items.length - 1]!);
		}
	}

	// Removes the group declaration: items dissolve back into individual tab
	// stops. Listener bookkeeping is aborted; the container itself lives on.
	dispose(): void {
		this.#controller.abort();
		this.container.removeAttribute('focusgroup');
		this.container.data.set(memoryKey, undefined);
	}

	#index(items: Node[]): number {
		return items.indexOf(this.focus.activeElement);
	}

	#move(delta: number): void {
		const items = this.items;
		const idx = this.#index(items);
		if (idx === -1) {
			return;
		}
		const target = this.config.wrap
			? items[(idx + delta + items.length) % items.length]
			: items[idx + delta];
		if (target && target !== items[idx]) {
			this.focus.focus(target);
		}
	}
}

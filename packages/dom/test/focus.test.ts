import { describe, expect, it } from '../test/suite.ts';
import { createRoot, FocusEvent, FocusManager, type Node, type Root } from '../src/index.ts';

function addChild(root: Root, parent: Node, localName: string, tabindex?: number): Node {
	const node = root.createElement(localName);
	if (tabindex !== undefined) {
		node.setAttribute('tabindex', tabindex);
	}
	parent.append(node);
	return node;
}

describe('FocusManager construction', () => {
	it('seeds the first focusable descendant', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'A', 0);
		addChild(root, root.documentElement, 'B', 0);
		const focus = new FocusManager(root.documentElement);
		expect(focus.activeElement).toBe(a);
		expect(a.states.has('focus')).toBe(true);
		root.destroy();
	});

	it('focuses nothing on an empty container; activeElement falls back to root', () => {
		const root = createRoot();
		const focus = new FocusManager(root.documentElement);
		expect(focus.activeElement).toBe(root.documentElement);
		expect(root.documentElement.states.has('focus')).toBe(false);
		root.destroy();
	});

	it('does not enroll root in the ring', () => {
		const root = createRoot();
		addChild(root, root.documentElement, 'A', 0);
		addChild(root, root.documentElement, 'B', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		const names: string[] = [];
		for (let i = 0; i < 3; i++) {
			names.push(focus.activeElement.localName);
			focus.next();
		}
		expect(names).toEqual(['A', 'B', 'A']); // wraps A->B->A; root never appears
		root.destroy();
	});

	it('escape hatch: a tabindex on root keeps it in the ring', () => {
		const root = createRoot();
		root.documentElement.setAttribute('tabindex', 0); // explicit enrollment
		const a = addChild(root, root.documentElement, 'A', 0);
		const focus = new FocusManager(root.documentElement); // seeds A, skipping root
		expect(focus.activeElement).toBe(a);
		focus.next(); // A -> root (wrap now includes root)
		expect(focus.activeElement).toBe(root.documentElement);
		root.destroy();
	});
});

describe('tabindex', () => {
	it('a node without tabindex is skipped by the ring', () => {
		const root = createRoot();
		addChild(root, root.documentElement, 'skip'); // no tabindex
		addChild(root, root.documentElement, 'here', 0);
		const focus = new FocusManager(root.documentElement); // seeds "here"
		expect(focus.activeElement.localName).toEqual('here');
		root.destroy();
	});

	it('tabindex -1 is programmatically focusable but not sequentially', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'A', 0);
		const hidden = addChild(root, root.documentElement, 'hidden', -1);
		addChild(root, root.documentElement, 'B', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		focus.next();
		expect(focus.activeElement.localName).toEqual('B'); // ring skips hidden
		focus.focus(hidden); // but programmatic focus works
		expect(focus.activeElement).toBe(hidden);
		expect(a.states.has('focus')).toBe(false);
		root.destroy();
	});
});

describe('sequential traversal', () => {
	it('depth-first order, flat children', () => {
		const root = createRoot();
		for (const name of ['A', 'B', 'C']) {
			addChild(root, root.documentElement, name, 0);
		}
		const focus = new FocusManager(root.documentElement); // seeds A
		const names: string[] = [];
		for (let i = 0; i < 4; i++) {
			names.push(focus.activeElement.localName);
			focus.next();
		}
		expect(names).toEqual(['A', 'B', 'C', 'A']);
		root.destroy();
	});

	it('depth-first order, nested children', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'A', 0);
		addChild(root, a, 'A1', 0);
		addChild(root, root.documentElement, 'B', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		const names: string[] = [];
		for (let i = 0; i < 4; i++) {
			names.push(focus.activeElement.localName);
			focus.next();
		}
		expect(names).toEqual(['A', 'A1', 'B', 'A']);
		root.destroy();
	});

	it('next moves forward, previous moves back, both wrap', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'A', 0);
		const b = addChild(root, root.documentElement, 'B', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		focus.next();
		expect(focus.activeElement).toBe(b);
		focus.next(); // wrap
		expect(focus.activeElement).toBe(a);
		focus.previous(); // wrap back
		expect(focus.activeElement).toBe(b);
		root.destroy();
	});

	it('single focusable node is a no-op', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'A', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		focus.next();
		expect(focus.activeElement).toBe(a);
		root.destroy();
	});

	it('no stops at all is a no-op', () => {
		const root = createRoot();
		const focus = new FocusManager(root.documentElement);
		focus.next();
		expect(focus.activeElement).toBe(root.documentElement);
		root.destroy();
	});

	it('focusables added after construction: next() enters the ring', () => {
		const root = createRoot();
		const focus = new FocusManager(root.documentElement); // nothing to seed
		const late = addChild(root, root.documentElement, 'late', 0);
		focus.next();
		expect(focus.activeElement).toBe(late);
		root.destroy();
	});
});

describe('focus()', () => {
	it('explicitly focuses a node', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'A', 0);
		const b = addChild(root, root.documentElement, 'B', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		focus.focus(b);
		expect(focus.activeElement).toBe(b);
		expect(a.states.has('focus')).toBe(false);
		expect(b.states.has('focus')).toBe(true);
		root.destroy();
	});

	it('throws on a node without a tabindex', () => {
		const root = createRoot();
		const child = addChild(root, root.documentElement, 'nope');
		const focus = new FocusManager(root.documentElement);
		expect(() => focus.focus(child)).toThrow();
		root.destroy();
	});

	it('is a no-op when already focused', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'A', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		let events = 0;
		a.addEventListener('focus', () => events++);
		focus.focus(a); // already focused -> no-op
		expect(focus.activeElement).toBe(a);
		expect(events).toEqual(0);
		root.destroy();
	});
});

describe('focus events', () => {
	it('fires blur/focusout at the old node, then focus/focusin at the new', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'A', 0);
		const b = addChild(root, root.documentElement, 'B', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		const order: string[] = [];
		for (const type of ['blur', 'focusout'] as const) {
			a.addEventListener(type, () => order.push(`${type}:A`));
		}
		for (const type of ['focus', 'focusin'] as const) {
			b.addEventListener(type, () => order.push(`${type}:B`));
		}
		focus.focus(b);
		expect(order).toEqual(['blur:A', 'focusout:A', 'focus:B', 'focusin:B']);
		root.destroy();
	});

	it('relatedTarget points at the other side of the transition', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'A', 0);
		const b = addChild(root, root.documentElement, 'B', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		let blurRelated: Node | undefined;
		let focusRelated: Node | undefined;
		a.addEventListener('blur', (event) => {
			blurRelated = (event as FocusEvent).relatedTarget;
		});
		b.addEventListener('focus', (event) => {
			focusRelated = (event as FocusEvent).relatedTarget;
		});
		focus.focus(b);
		expect(blurRelated).toBe(b);
		expect(focusRelated).toBe(a);
		root.destroy();
	});

	it('focus does not bubble; focusin bubbles; capture sees both', () => {
		const root = createRoot();
		addChild(root, root.documentElement, 'A', 0);
		const b = addChild(root, root.documentElement, 'B', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		const seen: string[] = [];
		root.documentElement.addEventListener('focus', () => seen.push('focus-bubble'));
		root.documentElement.addEventListener('focus', () => seen.push('focus-capture'), {
			capture: true,
		});
		root.documentElement.addEventListener('focusin', () => seen.push('focusin-bubble'));
		focus.focus(b);
		expect(seen).toEqual(['focus-capture', 'focusin-bubble']);
		root.destroy();
	});
});

describe('focused node removal', () => {
	it('removing the focused node advances focus', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'A', 0);
		addChild(root, root.documentElement, 'B', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		expect(a.states.has('focus')).toBe(true);
		a.remove();
		expect(focus.activeElement.localName).toEqual('B');
		root.destroy();
	});

	it('removing a non-focused node does not move focus', () => {
		const root = createRoot();
		addChild(root, root.documentElement, 'A', 0);
		const b = addChild(root, root.documentElement, 'B', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		b.remove();
		expect(focus.activeElement.localName).toEqual('A');
		root.destroy();
	});

	it('removing an ancestor of the focused node moves focus out of the subtree', () => {
		const root = createRoot();
		const panel = addChild(root, root.documentElement, 'panel');
		const inner = addChild(root, panel, 'inner', 0);
		addChild(root, root.documentElement, 'B', 0);
		const focus = new FocusManager(root.documentElement); // seeds inner
		expect(focus.activeElement).toBe(inner);
		panel.remove();
		expect(focus.activeElement.localName).toEqual('B');
		root.destroy();
	});

	it('removing the last focusable clears the pointer', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'A', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		a.remove();
		expect(focus.activeElement).toBe(root.documentElement);
		root.destroy();
	});
});

import { describe, expect, it } from '../test/suite.ts';
import { createRoot, FocusManager, type Node, type Root } from '../src/index.ts';

function nextMicrotask(): Promise<void> {
	return Promise.resolve();
}

function addChild(root: Root, parent: Node, localName: string, tabindex?: number): Node {
	const node = root.createElement(localName);
	if (tabindex !== undefined) {
		node.setAttribute('tabindex', tabindex);
	}
	parent.append(node);
	return node;
}

describe('node.states', () => {
	it('starts empty and round-trips add/has/delete', () => {
		const root = createRoot();
		const node = root.createElement('a');
		expect(node.states.size).toEqual(0);
		node.states.add('focus');
		expect(node.states.has('focus')).toBe(true);
		expect(node.states.delete('focus')).toBe(true);
		expect(node.states.has('focus')).toBe(false);
		root.destroy();
	});

	it('is separate from attributes', () => {
		const root = createRoot();
		const node = root.documentElement;
		node.states.add('focus');
		expect(node.hasAttribute('focus')).toBe(false);
		expect(Object.keys(node.attributes)).toEqual([]);
		root.destroy();
	});

	it('mutations coalesce into one change event', async () => {
		const root = createRoot();
		const a = root.createElement('a');
		root.documentElement.append(a);
		await nextMicrotask(); // settle the append burst
		let changes = 0;
		root.addEventListener('change', () => changes++);
		a.states.add('focus');
		a.states.add('focus-within');
		await nextMicrotask();
		expect(changes).toEqual(1);
		root.destroy();
	});

	it('redundant mutations do not emit a change', async () => {
		const root = createRoot();
		const a = root.createElement('a');
		root.documentElement.append(a);
		a.states.add('focus');
		await nextMicrotask();
		let changes = 0;
		root.addEventListener('change', () => changes++);
		a.states.add('focus'); // already present
		a.states.delete('absent');
		await nextMicrotask();
		expect(changes).toEqual(0);
		root.destroy();
	});
});

describe('FocusManager states', () => {
	it('seeding sets focus on the node and focus-within up the chain', () => {
		const root = createRoot();
		const panel = addChild(root, root.documentElement, 'panel');
		const a = addChild(root, panel, 'A', 0);
		new FocusManager(root.documentElement);
		expect(a.states.has('focus')).toBe(true);
		expect(a.states.has('focus-within')).toBe(true);
		expect(panel.states.has('focus-within')).toBe(true);
		expect(root.documentElement.states.has('focus-within')).toBe(true);
		expect(panel.states.has('focus')).toBe(false);
		root.destroy();
	});

	it('does not write a focused attribute', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'A', 0);
		new FocusManager(root.documentElement);
		expect(a.hasAttribute('focused')).toBe(false);
		root.destroy();
	});

	it('a transition moves focus and focus-within to the new chain', () => {
		const root = createRoot();
		const left = addChild(root, root.documentElement, 'left');
		const a = addChild(root, left, 'A', 0);
		const right = addChild(root, root.documentElement, 'right');
		const b = addChild(root, right, 'B', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		focus.focus(b);
		expect(a.states.has('focus')).toBe(false);
		expect(a.states.has('focus-within')).toBe(false);
		expect(left.states.has('focus-within')).toBe(false);
		expect(b.states.has('focus')).toBe(true);
		expect(right.states.has('focus-within')).toBe(true);
		// the shared ancestor keeps focus-within across the transition
		expect(root.documentElement.states.has('focus-within')).toBe(true);
		root.destroy();
	});

	it('removing the focused node moves the states to the successor', () => {
		const root = createRoot();
		const left = addChild(root, root.documentElement, 'left');
		const a = addChild(root, left, 'A', 0);
		const b = addChild(root, root.documentElement, 'B', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		a.remove();
		expect(focus.activeElement).toBe(b);
		expect(b.states.has('focus')).toBe(true);
		// the surviving ancestor of the removed node is no longer in the chain
		expect(left.states.has('focus-within')).toBe(false);
		root.destroy();
	});

	it('removing the last focusable clears focus-within from survivors', () => {
		const root = createRoot();
		const panel = addChild(root, root.documentElement, 'panel');
		const a = addChild(root, panel, 'A', 0);
		const focus = new FocusManager(root.documentElement); // seeds A
		a.remove();
		expect(focus.activeElement).toBe(root.documentElement);
		expect(panel.states.has('focus-within')).toBe(false);
		expect(root.documentElement.states.has('focus-within')).toBe(false);
		root.destroy();
	});
});

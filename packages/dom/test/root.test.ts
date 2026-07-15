import { describe, expect, it } from '../test/suite.ts';
import { createRoot } from '../src/index.ts';

function nextMicrotask(): Promise<void> {
	return Promise.resolve();
}

describe('createRoot', () => {
	it('returns a root with a parentless, connected document element', () => {
		const root = createRoot();
		expect(root.documentElement).toBeTruthy();
		expect(root.documentElement.parent).toBeUndefined();
		expect(root.documentElement.isConnected).toBe(true);
		expect(root.documentElement.id).toBeTruthy();
		root.destroy();
	});

	it('createElement returns a detached node with a unique id', () => {
		const root = createRoot();
		const a = root.createElement('a');
		const b = root.createElement('b');
		expect(a.localName).toEqual('a');
		expect(a.parent).toBeUndefined();
		expect(a.isConnected).toBe(false);
		expect(a.id).not.toEqual(b.id);
		expect(a.id).not.toEqual(root.documentElement.id);
		root.destroy();
	});

	it('append attaches and connects, in order', () => {
		const root = createRoot();
		const a = root.createElement('a');
		const b = root.createElement('b');
		root.documentElement.append(a, b);
		expect(a.parent).toBe(root.documentElement);
		expect(a.isConnected).toBe(true);
		expect([...root.documentElement.children]).toEqual([a, b]);
		root.destroy();
	});

	it('insertBefore inserts at the reference position', () => {
		const root = createRoot();
		const a = root.createElement('a');
		const c = root.createElement('c');
		root.documentElement.append(a, c);
		const b = root.createElement('b');
		root.documentElement.insertBefore(b, c);
		expect([...root.documentElement.children]).toEqual([a, b, c]);
		root.destroy();
	});

	it('insertBefore throws when the reference is not a child', () => {
		const root = createRoot();
		const a = root.createElement('a');
		const inner = root.createElement('inner');
		a.append(inner);
		root.documentElement.append(a);
		const b = root.createElement('b');
		expect(() => root.documentElement.insertBefore(b, inner)).toThrow();
		root.destroy();
	});

	it('append throws on cycles and cross-tree nodes', () => {
		const root = createRoot();
		const a = root.createElement('a');
		const inner = root.createElement('inner');
		a.append(inner);
		expect(() => inner.append(a)).toThrow(); // ancestor into descendant
		expect(() => a.append(a)).toThrow(); // self
		const other = createRoot();
		expect(() => root.documentElement.append(other.createElement('x'))).toThrow();
		other.destroy();
		root.destroy();
	});

	it('a subtree can be built detached and connected in one append', () => {
		const root = createRoot();
		const panel = root.createElement('panel');
		const item = root.createElement('item');
		panel.append(item);
		expect(item.isConnected).toBe(false);
		root.documentElement.append(panel);
		expect(item.isConnected).toBe(true);
		root.destroy();
	});
});

describe('moves', () => {
	it('appending an attached node relocates it (reorder)', () => {
		const root = createRoot();
		const a = root.createElement('a');
		const b = root.createElement('b');
		const c = root.createElement('c');
		root.documentElement.append(a, b, c);
		root.documentElement.append(a); // move a to the end
		expect([...root.documentElement.children].map((n) => n.localName)).toEqual(['b', 'c', 'a']);
		root.documentElement.insertBefore(c, b); // move c before b
		expect([...root.documentElement.children].map((n) => n.localName)).toEqual(['c', 'b', 'a']);
		root.destroy();
	});

	it('moves are state-preserving: signal live, listeners intact, no remove event', () => {
		const root = createRoot();
		const a = root.createElement('a');
		const b = root.createElement('b');
		root.documentElement.append(a, b);
		let pings = 0;
		let removes = 0;
		a.addEventListener('ping', () => pings++);
		root.documentElement.addEventListener('remove', () => removes++);
		root.documentElement.append(a); // move
		expect(a.signal.aborted).toBe(false);
		expect(removes).toEqual(0);
		a.dispatchEvent(new Event('ping'));
		expect(pings).toEqual(1);
		root.destroy();
	});

	it('a move across parents keeps the subtree connected', () => {
		const root = createRoot();
		const left = root.createElement('left');
		const right = root.createElement('right');
		root.documentElement.append(left, right);
		const item = root.createElement('item');
		left.append(item);
		right.append(item); // move between containers
		expect(item.parent).toBe(right);
		expect(item.isConnected).toBe(true);
		expect([...left.children]).toEqual([]);
		root.destroy();
	});

	it('a removed node cannot be re-inserted', () => {
		const root = createRoot();
		const a = root.createElement('a');
		root.documentElement.append(a);
		a.remove();
		expect(() => root.documentElement.append(a)).toThrow();
		root.destroy();
	});
});

describe('attributes', () => {
	it('set/get/has/remove round-trip; snapshot is frozen', () => {
		const root = createRoot();
		const node = root.documentElement;
		node.setAttribute('n', 5);
		expect(node.getAttribute('n')).toEqual(5);
		expect(node.hasAttribute('n')).toBe(true);
		expect(node.attributes['n']).toEqual(5);
		expect(Object.isFrozen(node.attributes)).toBe(true);
		node.removeAttribute('n');
		expect(node.hasAttribute('n')).toBe(false);
		expect(() => node.removeAttribute('n')).not.toThrow();
		root.destroy();
	});

	it('rejects invalid JsonValues', () => {
		const root = createRoot();
		const node = root.documentElement;
		expect(() => node.setAttribute('bad', undefined as never)).toThrow();
		expect(() => node.setAttribute('bad', Number.NaN)).toThrow();
		expect(() => node.setAttribute('bad', (() => {}) as never)).toThrow();
		expect(node.hasAttribute('bad')).toBe(false);
		root.destroy();
	});
});

describe('getElementById', () => {
	it('resolves connected nodes only, like the DOM', () => {
		const root = createRoot();
		const a = root.createElement('a');
		expect(root.getElementById(a.id)).toBeUndefined(); // detached
		root.documentElement.append(a);
		expect(root.getElementById(a.id)).toBe(a);
		expect(root.getElementById(root.documentElement.id)).toBe(root.documentElement);
		expect(root.getElementById('nope')).toBeUndefined();
		root.destroy();
	});

	it('forgets removed subtrees', () => {
		const root = createRoot();
		const a = root.createElement('a');
		const inner = root.createElement('inner');
		a.append(inner);
		root.documentElement.append(a);
		a.remove();
		expect(root.getElementById(a.id)).toBeUndefined();
		expect(root.getElementById(inner.id)).toBeUndefined();
		root.destroy();
	});
});

describe('remove', () => {
	it('detaches and destroys the subtree', () => {
		const root = createRoot();
		const a = root.createElement('a');
		root.documentElement.append(a);
		a.remove();
		expect([...root.documentElement.children]).toEqual([]);
		expect(a.parent).toBeUndefined();
		expect(a.isConnected).toBe(false);
		root.destroy();
	});

	it('throws on the document element', () => {
		const root = createRoot();
		expect(() => root.documentElement.remove()).toThrow();
		root.destroy();
	});

	it('destroys a detached node without an event', () => {
		const root = createRoot();
		const a = root.createElement('a');
		let removes = 0;
		a.addEventListener('remove', () => removes++);
		a.remove();
		expect(a.signal.aborted).toBe(true);
		expect(removes).toEqual(0);
		root.destroy();
	});
});

describe('contains', () => {
	it('is inclusive of self and descendants', () => {
		const root = createRoot();
		const a = root.createElement('a');
		const inner = root.createElement('inner');
		a.append(inner);
		root.documentElement.append(a);
		expect(a.contains(a)).toBe(true);
		expect(a.contains(inner)).toBe(true);
		expect(root.documentElement.contains(inner)).toBe(true);
		expect(inner.contains(a)).toBe(false);
		root.destroy();
	});
});

describe('change notification', () => {
	it('emits one coalesced change per microtask burst', async () => {
		const root = createRoot();
		let changes = 0;
		root.addEventListener('change', () => changes++);
		root.documentElement.setAttribute('a', 1);
		root.documentElement.setAttribute('b', 2);
		root.documentElement.append(root.createElement('c'));
		await nextMicrotask();
		expect(changes).toEqual(1);
		root.destroy();
	});

	it('emits again for a later burst', async () => {
		const root = createRoot();
		let changes = 0;
		root.addEventListener('change', () => changes++);
		root.documentElement.setAttribute('a', 1);
		await nextMicrotask();
		root.documentElement.setAttribute('a', 2);
		await nextMicrotask();
		expect(changes).toEqual(2);
		root.destroy();
	});

	it('mutations from event listeners coalesce into one change', async () => {
		const root = createRoot();
		const input = root.createElement('input');
		root.documentElement.append(input);
		input.addEventListener('keydown', () => {
			input.setAttribute('value', 'x');
			input.setAttribute('cursor', 1);
		});
		let changes = 0;
		root.addEventListener('change', () => changes++);
		input.dispatchEvent(new Event('keydown', { bubbles: true }));
		await nextMicrotask();
		expect(changes).toEqual(1);
		root.destroy();
	});

	it('does not emit after destroy', async () => {
		const root = createRoot();
		let changes = 0;
		root.addEventListener('change', () => changes++);
		root.documentElement.setAttribute('a', 1);
		root.destroy();
		await nextMicrotask();
		expect(changes).toEqual(0);
	});
});

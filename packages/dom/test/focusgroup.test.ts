import { describe, expect, it } from '../test/suite.ts';
import {
	createRoot,
	FocusGroupManager,
	FocusManager,
	type Node,
	parseFocusgroup,
	type Root,
} from '../src/index.ts';

function addChild(root: Root, parent: Node, localName: string, tabindex?: number): Node {
	const node = root.createElement(localName);
	if (tabindex !== undefined) {
		node.setAttribute('tabindex', tabindex);
	}
	parent.append(node);
	return node;
}

// before | group(one, two) | after — the canonical toolbar-between-stops tree.
function fixture(): {
	root: Root;
	before: Node;
	group: Node;
	one: Node;
	two: Node;
	after: Node;
} {
	const root = createRoot();
	const before = addChild(root, root.documentElement, 'before', 0);
	const group = addChild(root, root.documentElement, 'group');
	const one = addChild(root, group, 'one', 0);
	const two = addChild(root, group, 'two', 0);
	const after = addChild(root, root.documentElement, 'after', 0);
	return { root, before, group, one, two, after };
}

describe('parseFocusgroup', () => {
	it('applies behavior token defaults', () => {
		expect(parseFocusgroup('toolbar')).toEqual({
			behavior: 'toolbar',
			axis: 'inline',
			wrap: false,
			memory: true,
		});
		expect(parseFocusgroup('tablist')).toEqual({
			behavior: 'tablist',
			axis: 'inline',
			wrap: true,
			memory: true,
		});
		expect(parseFocusgroup('listbox')).toEqual({
			behavior: 'listbox',
			axis: 'block',
			wrap: false,
			memory: true,
		});
		expect(parseFocusgroup('radiogroup')).toEqual({
			behavior: 'radiogroup',
			axis: 'both',
			wrap: true,
			memory: true,
		});
	});

	it('modifier tokens override behavior defaults', () => {
		expect(parseFocusgroup('toolbar wrap').wrap).toBe(true);
		expect(parseFocusgroup('tablist nowrap').wrap).toBe(false);
		expect(parseFocusgroup('toolbar block').axis).toBe('block');
		expect(parseFocusgroup('menu nomemory').memory).toBe(false);
	});

	it('bare value falls back to both axes, nowrap, memory', () => {
		expect(parseFocusgroup('')).toEqual({
			behavior: undefined,
			axis: 'both',
			wrap: false,
			memory: true,
		});
	});
});

describe('declarative focusgroup (attribute only, no manager)', () => {
	it('collapses the group to a single tab stop entering at the first item', () => {
		const { root, group, before } = fixture();
		group.setAttribute('focusgroup', 'toolbar');
		const focus = new FocusManager(root.documentElement); // seeds before
		expect(focus.activeElement).toBe(before);
		const names: string[] = [];
		for (let i = 0; i < 4; i++) {
			focus.next();
			names.push(focus.activeElement.localName);
		}
		// one enters the group; two is only reachable by arrows, never by Tab
		expect(names).toEqual(['one', 'after', 'before', 'one']);
		root.destroy();
	});

	it('previous() enters the group from the other side at the same entry', () => {
		const { root, group } = fixture();
		group.setAttribute('focusgroup', 'toolbar');
		const focus = new FocusManager(root.documentElement); // seeds before
		focus.previous(); // wraps to after
		focus.previous(); // group entry (first item — no memory recorded yet)
		expect(focus.activeElement.localName).toEqual('one');
		root.destroy();
	});
});

describe('FocusGroupManager traversal', () => {
	it('next/previous move between items; nowrap stops at the ends', () => {
		const { root, group, one, two } = fixture();
		const focus = new FocusManager(root.documentElement);
		const g = new FocusGroupManager(focus, group, 'toolbar'); // nowrap
		focus.focus(one);
		g.next();
		expect(focus.activeElement).toBe(two);
		g.next(); // end, no wrap
		expect(focus.activeElement).toBe(two);
		g.previous();
		expect(focus.activeElement).toBe(one);
		g.previous(); // start, no wrap
		expect(focus.activeElement).toBe(one);
		root.destroy();
	});

	it('wrap cycles at the ends', () => {
		const { root, group, one, two } = fixture();
		const focus = new FocusManager(root.documentElement);
		const g = new FocusGroupManager(focus, group, 'tablist'); // wrap by default
		focus.focus(two);
		g.next();
		expect(focus.activeElement).toBe(one);
		g.previous();
		expect(focus.activeElement).toBe(two);
		root.destroy();
	});

	it('no-ops while focus is outside the group (safe to bind globally)', () => {
		const { root, group, before } = fixture();
		const focus = new FocusManager(root.documentElement); // seeds before
		const g = new FocusGroupManager(focus, group, 'toolbar');
		g.next();
		g.first();
		g.last();
		expect(focus.activeElement).toBe(before);
		root.destroy();
	});

	it('first/last jump within the group (Home/End)', () => {
		const { root, group, one, two } = fixture();
		const focus = new FocusManager(root.documentElement);
		const g = new FocusGroupManager(focus, group, 'toolbar');
		focus.focus(two);
		g.first();
		expect(focus.activeElement).toBe(one);
		g.last();
		expect(focus.activeElement).toBe(two);
		root.destroy();
	});

	it('exposes the parsed axis for key binding', () => {
		const { root, group } = fixture();
		const focus = new FocusManager(root.documentElement);
		const g = new FocusGroupManager(focus, group, 'listbox');
		expect(g.axis).toEqual('block');
		root.destroy();
	});
});

describe('focus memory (roving tab stop)', () => {
	it('re-entering the group returns to the last-focused item', () => {
		const { root, group, one, two, after } = fixture();
		const focus = new FocusManager(root.documentElement);
		const g = new FocusGroupManager(focus, group, 'toolbar');
		focus.focus(one);
		g.next(); // two — recorded as memory via focusin
		focus.focus(after); // leave the group
		focus.previous(); // Tab back in
		expect(focus.activeElement).toBe(two);
		root.destroy();
	});

	it('nomemory always enters at the first item', () => {
		const { root, group, one, two, after } = fixture();
		const focus = new FocusManager(root.documentElement);
		const g = new FocusGroupManager(focus, group, 'toolbar nomemory');
		focus.focus(two);
		g.previous();
		g.next(); // back on two, but nothing recorded
		focus.focus(after);
		focus.previous();
		expect(focus.activeElement).toBe(one);
		root.destroy();
	});

	it('memory pointing at a removed item falls back to the first item', () => {
		const { root, group, one, two, after } = fixture();
		const focus = new FocusManager(root.documentElement);
		new FocusGroupManager(focus, group, 'toolbar');
		focus.focus(two); // memory = two
		focus.focus(after);
		two.remove(); // memory is now a dead node (signal aborted)
		focus.previous();
		expect(focus.activeElement).toBe(one);
		root.destroy();
	});

	it('memory pointing at an item moved out of the group falls back', () => {
		const { root, group, one, two, after } = fixture();
		const focus = new FocusManager(root.documentElement);
		new FocusGroupManager(focus, group, 'toolbar');
		focus.focus(two); // memory = two
		focus.focus(after);
		root.documentElement.append(two); // move two out of the group (still alive)
		focus.previous(); // group entry falls back: memory is no longer inside
		expect(focus.activeElement).toBe(one);
		root.destroy();
	});
});

describe('opting out and nesting', () => {
	it("focusgroup='none' items leave the group and become their own tab stop", () => {
		const { root, group, one, two } = fixture();
		const opt = addChild(root, group, 'opt', 0);
		opt.setAttribute('focusgroup', 'none');
		const focus = new FocusManager(root.documentElement);
		const g = new FocusGroupManager(focus, group, 'toolbar');
		expect(g.items).toEqual([one, two]);
		const names: string[] = [];
		for (let i = 0; i < 4; i++) {
			focus.next();
			names.push(focus.activeElement.localName);
		}
		expect(names).toEqual(['one', 'opt', 'after', 'before']);
		root.destroy();
	});

	it('a nested focusgroup is an independent segment with its own stop', () => {
		const { root, group, one, two } = fixture();
		const inner = addChild(root, group, 'inner');
		const innerItem = addChild(root, inner, 'inner-item', 0);
		const focus = new FocusManager(root.documentElement);
		const outer = new FocusGroupManager(focus, group, 'toolbar');
		const nested = new FocusGroupManager(focus, inner, 'menu');
		expect(outer.items).toEqual([one, two]);
		expect(nested.items).toEqual([innerItem]);
		const names: string[] = [];
		for (let i = 0; i < 4; i++) {
			focus.next();
			names.push(focus.activeElement.localName);
		}
		expect(names).toEqual(['one', 'inner-item', 'after', 'before']);
		root.destroy();
	});
});

describe('dispose()', () => {
	it('dissolves the group back into individual tab stops', () => {
		const { root, group, one } = fixture();
		const focus = new FocusManager(root.documentElement);
		const g = new FocusGroupManager(focus, group, 'toolbar');
		focus.focus(one);
		g.dispose();
		expect(group.hasAttribute('focusgroup')).toBe(false);
		const names: string[] = [];
		for (let i = 0; i < 4; i++) {
			focus.next();
			names.push(focus.activeElement.localName);
		}
		expect(names).toEqual(['two', 'after', 'before', 'one']);
		root.destroy();
	});
});

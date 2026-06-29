import { createElement as h, type ReactNode, useState } from 'react';
import { createRoot, type Node } from '@bomb.sh/freedom';
import { mount } from '../src/index.ts';
import { describe, expect, it } from './suite.ts';

function kids(node: Node): Node[] {
	return [...node.children];
}

describe('mount', () => {
	it('builds a freedom subtree under the node', () => {
		const root = createRoot();
		mount(h('box', { color: 'red' }, h('label', { value: 'hi' })), root.node);

		const [box] = kids(root.node);
		expect(box.name).toEqual('box');
		expect(box.props['color']).toEqual('red');

		const [label] = kids(box);
		expect(label.name).toEqual('label');
		expect(label.props['value']).toEqual('hi');

		root.destroy();
	});

	it('renders text children as #text nodes', () => {
		const root = createRoot();
		mount(h('label', null, 'hello'), root.node);

		const [label] = kids(root.node);
		const [text] = kids(label);
		expect(text.name).toEqual('#text');
		expect(text.props['text']).toEqual('hello');

		root.destroy();
	});

	it('skips function and undefined props', () => {
		const root = createRoot();
		mount(h('box', { onClick: () => {}, missing: undefined, n: 1 }), root.node);

		const [box] = kids(root.node);
		expect('onClick' in box.props).toBe(false);
		expect('missing' in box.props).toBe(false);
		expect(box.props['n']).toEqual(1);

		root.destroy();
	});

	it('does not reconcile children of a <foreign> node', () => {
		const root = createRoot();
		mount(h('foreign', null, h('box'), h('box')), root.node);

		const [foreign] = kids(root.node);
		expect(foreign.name).toEqual('foreign');
		expect(kids(foreign).length).toEqual(0);

		root.destroy();
	});

	it('updates props on state change', () => {
		const root = createRoot();

		let set: (n: number) => void = () => {};
		function App(): ReactNode {
			const [n, setN] = useState(0);
			set = setN;
			return h('box', { n });
		}

		mount(h(App), root.node);
		const [box] = kids(root.node);
		expect(box.props['n']).toEqual(0);

		set(5);
		expect(box.props['n']).toEqual(5);

		root.destroy();
	});

	it('inserts a new child before a sibling', () => {
		const root = createRoot();

		let set: (items: string[]) => void = () => {};
		function App(): ReactNode {
			const [items, setItems] = useState(['a', 'c']);
			set = setItems;
			return h('box', null, ...items.map((k) => h('item', { key: k, value: k })));
		}

		mount(h(App), root.node);
		const [box] = kids(root.node);
		expect(kids(box).map((c) => c.props['value'])).toEqual(['a', 'c']);

		set(['a', 'b', 'c']);
		expect(kids(box).map((c) => c.props['value'])).toEqual(['a', 'b', 'c']);

		root.destroy();
	});

	it('removes a child', () => {
		const root = createRoot();

		let set: (items: string[]) => void = () => {};
		function App(): ReactNode {
			const [items, setItems] = useState(['a', 'b']);
			set = setItems;
			return h('box', null, ...items.map((k) => h('item', { key: k, value: k })));
		}

		mount(h(App), root.node);
		const [box] = kids(root.node);
		expect(kids(box).map((c) => c.props['value'])).toEqual(['a', 'b']);

		set(['a']);
		expect(kids(box).map((c) => c.props['value'])).toEqual(['a']);

		root.destroy();
	});
});

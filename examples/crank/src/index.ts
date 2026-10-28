/* oxlint-disable bombshell-dev/no-generic-error -- Reject invalid host callback values with standard TypeError exceptions. */
/* oxlint-disable bombshell-dev/exported-function-async -- Framework mounting and host factories are synchronous by contract. */
import { Renderer, type Children, type ElementValue } from '@b9g/crank';
import { Element, Text, type Node } from '@bomb.sh/dom';
import { updateHostProperties } from './properties.ts';

/** Crank's generic reconciler using the same native tree as all other adapters. */
const renderer = new Renderer<Node, null, Element>({
	create({ tag, root }) {
		if (!root) throw new TypeError('A Crank container is required');
		if (typeof tag !== 'string') throw new TypeError('Unsupported Crank host tag');
		return root.ownerDocument.createElement(tag);
	},
	text({ value, oldNode, root }) {
		if (oldNode instanceof Text) {
			oldNode.data = value;
			return oldNode;
		}
		if (!root) throw new TypeError('A Crank container is required');
		return root.ownerDocument.createTextNode(value);
	},
	patch({ node, props, oldProps }) {
		if (!(node instanceof Element)) throw new TypeError('Expected an Element');
		updateHostProperties(node, oldProps ?? {}, props);
	},
	arrange({ node, children }) {
		let anchor = node.firstChild;
		for (const child of children) {
			if (child === anchor) anchor = anchor.nextSibling;
			else node.insertBefore(child, anchor);
		}
	},
	remove({ node, parentNode, isNested }) {
		if (!isNested && node.parentNode === parentNode) parentNode.removeChild(node);
	},
	raw({ value }) {
		if (typeof value === 'string')
			throw new TypeError('Raw markup is not supported by this adapter');
		return value;
	},
});

export interface Root extends AsyncDisposable {
	readonly element: Element;
	render(children: Children): Promise<ElementValue<Node>>;
	unmount(): Promise<void>;
}

/** Mount Crank generator components into an existing native element. */
export function createRoot(element: Element): Root {
	return {
		element,
		async render(children) {
			return renderer.render(children, element);
		},
		async unmount() {
			await renderer.render(null, element);
		},
		async [Symbol.asyncDispose]() {
			await this.unmount();
		},
	};
}

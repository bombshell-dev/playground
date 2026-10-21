/* oxlint-disable bombshell-dev/no-generic-error -- Reject invalid host callback values with standard TypeError exceptions. */
/* oxlint-disable bombshell-dev/exported-function-async -- Framework mounting and host factories are synchronous by contract. */
import { createRenderer, type Renderer } from 'solid-js/universal';
import { Element, Text, type Document, type Node } from '@bomb.sh/dom';
import { setHostProperty } from './properties.ts';

export type SolidChild =
	| Node
	| string
	| number
	| boolean
	| null
	| undefined
	| readonly SolidChild[];
export interface SolidRenderer extends Pick<
	Renderer<Node>,
	| 'effect'
	| 'memo'
	| 'createComponent'
	| 'createElement'
	| 'createTextNode'
	| 'insertNode'
	| 'setProp'
	| 'mergeProps'
	| 'use'
> {
	render(component: () => Node, container: Node): () => void;
	insert(parent: Node, value: SolidChild | (() => SolidChild), marker?: Node | null): void;
	spread(
		node: Node,
		props: Record<string, unknown> | (() => Record<string, unknown>),
		skipChildren?: boolean,
	): void;
}

/** Bind Solid's universal runtime to a document for its entire reactive lifetime. */
export function createSolidRenderer(document: Document): SolidRenderer {
	const renderer = createRenderer<Node>({
		createElement: (name) => document.createElement(name),
		createTextNode: (value) => document.createTextNode(value),
		replaceText(node, value) {
			if (!(node instanceof Text)) throw new TypeError('Expected a Text node');
			node.data = value;
		},
		isTextNode: (node) => node instanceof Text,
		setProperty(node, name, value) {
			if (!(node instanceof Element)) throw new TypeError('Expected an Element');
			setHostProperty(node, name, value);
		},
		insertNode: (parent, child, anchor) => {
			parent.insertBefore(child, anchor ?? null);
		},
		removeNode: (parent, child) => {
			parent.removeChild(child);
		},
		getParentNode: (node) => node.parentNode ?? undefined,
		getFirstChild: (node) => node.firstChild ?? undefined,
		getNextSibling: (node) => node.nextSibling ?? undefined,
	});
	return {
		...renderer,
		render(component, container) {
			let root: Node | undefined;
			const dispose = renderer.render(() => (root = component()), container);
			return () => {
				dispose();
				root?.remove();
			};
		},
	};
}

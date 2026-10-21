import type { Node } from './dom.ts';

/** Standard traversal masks and filter results for the supported node kinds. */
export const NodeFilter = Object.freeze({
	FILTER_ACCEPT: 1,
	FILTER_REJECT: 2,
	FILTER_SKIP: 3,
	SHOW_ALL: 0xffffffff,
	SHOW_ELEMENT: 1,
	SHOW_ATTRIBUTE: 2,
	SHOW_TEXT: 4,
	SHOW_COMMENT: 128,
	SHOW_DOCUMENT: 256,
	SHOW_DOCUMENT_FRAGMENT: 1024,
});
export type NodeFilterCallback = ((node: Node) => number) | { acceptNode(node: Node): number };
/** Live depth-first traversal; rejected subtrees are pruned. */
export class TreeWalker {
	readonly root: Node;
	readonly whatToShow: number;
	readonly filter: NodeFilterCallback | null;
	currentNode: Node;
	constructor(
		root: Node,
		options: { whatToShow?: number; filter?: NodeFilterCallback | null } = {},
	) {
		this.root = root;
		this.currentNode = root;
		this.whatToShow = options.whatToShow ?? NodeFilter.SHOW_ALL;
		this.filter = options.filter ?? null;
	}
	#accept(node: Node): number {
		if (!(this.whatToShow & (1 << (node.nodeType - 1)))) return NodeFilter.FILTER_SKIP;
		return !this.filter
			? NodeFilter.FILTER_ACCEPT
			: typeof this.filter === 'function'
				? this.filter(node)
				: this.filter.acceptNode(node);
	}
	nextNode(): Node | null {
		let node = this.currentNode;
		let descend = true;
		while (true) {
			if (descend && node.firstChild) node = node.firstChild;
			else {
				while (node !== this.root && !node.nextSibling) {
					if (!node.parentNode) return null;
					node = node.parentNode;
				}
				if (node === this.root) return null;
				if (!node.nextSibling) return null;
				node = node.nextSibling;
			}
			const result = this.#accept(node);
			if (result === NodeFilter.FILTER_ACCEPT) {
				this.currentNode = node;
				return node;
			}
			descend = result !== NodeFilter.FILTER_REJECT;
		}
	}
	parentNode(): Node | null {
		let node = this.currentNode;
		while (node !== this.root && node.parentNode) {
			node = node.parentNode;
			if (this.#accept(node) === NodeFilter.FILTER_ACCEPT) {
				this.currentNode = node;
				return node;
			}
		}
		return null;
	}
}

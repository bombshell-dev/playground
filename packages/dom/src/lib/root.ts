import { NodeImpl, type TreeState } from './node.ts';
import type { Node, Root } from './types.ts';

class RootImpl extends EventTarget implements Root {
	readonly documentElement: NodeImpl;
	#tree: TreeState;
	#destroyed = false;
	#scheduled = false;

	constructor() {
		super();
		let counter = 0;
		const tree: TreeState = {
			registry: new Map(),
			documentElement: undefined,
			nextId: () => `node-${++counter}`,
			markDirty: () => this.#invalidate(),
		};
		this.#tree = tree;
		const node = new NodeImpl(tree.nextId(), '', tree);
		tree.documentElement = node;
		tree.registry.set(node.id, node);
		this.documentElement = node;
	}

	createElement(localName = ''): Node {
		// Detached until appended, like document.createElement. Not resolvable
		// via getElementById until connected.
		return new NodeImpl(this.#tree.nextId(), localName, this.#tree);
	}

	getElementById(id: string): Node | undefined {
		return this.#tree.registry.get(id);
	}

	// Coalesce change notifications per microtask: a burst of synchronous
	// mutations — one dispatched input event's worth of listener work, or
	// imperative tree building — produces a single `change`. Renderers see final
	// state only.
	#invalidate(): void {
		if (this.#destroyed || this.#scheduled) {
			return;
		}
		this.#scheduled = true;
		queueMicrotask(() => {
			this.#scheduled = false;
			if (!this.#destroyed) {
				this.dispatchEvent(new Event('change'));
			}
		});
	}

	destroy(): void {
		if (this.#destroyed) {
			return;
		}
		this.#destroyed = true;
		// Aborts every node's signal depth-first and forgets the tree.
		this.documentElement.destroy();
		this.#tree.registry.clear();
	}
}

export function createRoot(): Root {
	return new RootImpl();
}

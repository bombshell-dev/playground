// oxlint-disable bombshell-dev/no-generic-error
// oxlint-disable max-params
import { PropagationTarget } from './events.ts';
import type { JsonValue, Node, NodeData, NodeDataKey } from './types.ts';
import { validateJsonValue } from './validate.ts';

class NodeDataImpl implements NodeData {
	#map: Map<symbol, unknown> = new Map();

	get<T>(key: NodeDataKey<T>): T | undefined {
		return this.#map.get(key.symbol) as T | undefined;
	}

	set<T>(key: NodeDataKey<T>, value: T): void {
		this.#map.set(key.symbol, value);
	}

	expect<T>(key: NodeDataKey<T>): T {
		const val = this.#map.get(key.symbol);
		if (val !== undefined) {
			return val as T;
		} else if (key.defaultValue !== undefined) {
			return key.defaultValue;
		} else {
			throw new Error(`NodeData '${key.symbol.description}' not found`);
		}
	}
}

// CustomStateSet analog: a Set of pseudo-class flags that invalidates
// rendering on real mutations only (adding a present state or deleting an
// absent one is a no-op, no `change`).
class StateSetImpl extends Set<string> {
	#tree: TreeState;

	constructor(tree: TreeState) {
		super();
		this.#tree = tree;
	}

	override add(state: string): this {
		if (!super.has(state)) {
			super.add(state);
			this.#tree.markDirty();
		}
		return this;
	}

	override delete(state: string): boolean {
		const deleted = super.delete(state);
		if (deleted) {
			this.#tree.markDirty();
		}
		return deleted;
	}

	override clear(): void {
		if (this.size > 0) {
			super.clear();
			this.#tree.markDirty();
		}
	}
}

// Shared per-tree bookkeeping; owned by the root, threaded to every node.
// `registry` holds CONNECTED nodes only, so getElementById behaves like the
// DOM's (detached nodes are not resolvable by id).
export interface TreeState {
	registry: Map<string, NodeImpl>;
	documentElement: NodeImpl | undefined;
	nextId(): string;
	markDirty(): void;
}

export class NodeImpl extends PropagationTarget implements Node {
	_attributes: Record<string, JsonValue> = {};
	_children: NodeImpl[] = [];
	_parent: NodeImpl | undefined;
	readonly data: NodeData = new NodeDataImpl();
	readonly states: Set<string>;
	readonly #tree: TreeState;
	readonly #controller = new AbortController();

	constructor(
		readonly id: string,
		readonly localName: string,
		tree: TreeState,
	) {
		super();
		this.#tree = tree;
		this.states = new StateSetImpl(tree);
	}

	protected override getParentTarget(): PropagationTarget | undefined {
		return this._parent;
	}

	get attributes(): Record<string, JsonValue> {
		return Object.freeze({ ...this._attributes });
	}

	get children(): Iterable<Node> {
		return this._children.values();
	}

	get parent(): Node | undefined {
		return this._parent;
	}

	get isConnected(): boolean {
		if (this === this.#tree.documentElement) {
			return true;
		}
		return this._parent ? this._parent.isConnected : false;
	}

	get signal(): AbortSignal {
		return this.#controller.signal;
	}

	getAttribute(name: string): JsonValue | undefined {
		return this._attributes[name];
	}

	setAttribute(name: string, value: JsonValue): void {
		validateJsonValue(value);
		this._attributes[name] = value;
		this.#tree.markDirty();
	}

	hasAttribute(name: string): boolean {
		return name in this._attributes;
	}

	removeAttribute(name: string): void {
		if (name in this._attributes) {
			delete this._attributes[name];
			this.#tree.markDirty();
		}
	}

	contains(other: Node): boolean {
		for (let n: Node | undefined = other; n; n = n.parent) {
			if (n === this) {
				return true;
			}
		}
		return false;
	}

	append(...nodes: Node[]): void {
		for (const node of nodes) {
			this.#insert(node as NodeImpl, this._children.length);
		}
	}

	insertBefore(node: Node, reference: Node): void {
		const index = this._children.indexOf(reference as NodeImpl);
		if (index === -1) {
			throw new Error('insertBefore: `reference` is not a child of this node');
		}
		this.#insert(node as NodeImpl, index);
	}

	// Attach (or move) `child` at `index`. An already-attached child relocates
	// state-preservingly — no signal abort, no lifecycle events — matching the
	// DOM's `moveBefore()` semantics rather than remove-and-reinsert.
	#insert(child: NodeImpl, index: number): void {
		if (child.#tree !== this.#tree) {
			throw new Error('Cannot insert a node from another tree');
		}
		if (child === this.#tree.documentElement) {
			throw new Error('Cannot insert the document element');
		}
		if (child.contains(this)) {
			throw new Error('Cannot insert a node into its own subtree');
		}
		if (child.signal.aborted) {
			throw new Error('Cannot insert a removed node');
		}
		const wasConnected = child.isConnected;
		let at = index;
		if (child._parent) {
			const from = child._parent._children.indexOf(child);
			child._parent._children.splice(from, 1);
			// Moving forward under the same parent: account for the vacated slot.
			if (child._parent === this && from < at) {
				at -= 1;
			}
		}
		this._children.splice(at, 0, child);
		child._parent = this;
		const isConnected = child.isConnected;
		if (isConnected && !wasConnected) {
			child.#register();
		} else if (!isConnected && wasConnected) {
			child.#unregister();
		}
		this.#tree.markDirty();
	}

	#register(): void {
		this.#tree.registry.set(this.id, this);
		for (const child of this._children) {
			child.#register();
		}
	}

	#unregister(): void {
		this.#tree.registry.delete(this.id);
		for (const child of this._children) {
			child.#unregister();
		}
	}

	// Internal teardown — not on the public `Node` interface. Aborts each
	// node's signal depth-first, children before parents in reverse creation
	// order. Used by `remove` and by `root.destroy()`.
	destroy(): void {
		for (const child of [...this._children].reverse()) {
			child.destroy();
		}
		this.#controller.abort();
	}

	remove(): void {
		if (this === this.#tree.documentElement) {
			throw new Error('Cannot remove the document element');
		}
		if (this._parent) {
			// Announce before detaching, so `remove` bubbles through the
			// still-attached ancestor path — extensions (e.g. focus) react by
			// listening on an ancestor. Descendants get no event of their own —
			// their teardown notification is their aborting signal.
			this.dispatchEvent(new Event('remove', { bubbles: true }));
			if (this.isConnected) {
				this.#unregister();
			}
			const index = this._parent._children.indexOf(this);
			this._parent._children.splice(index, 1);
			this._parent = undefined;
		}
		this.destroy();
		this.#tree.markDirty();
	}
}

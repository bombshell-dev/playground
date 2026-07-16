export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export interface NodeDataKey<T> {
	readonly symbol: symbol;
	readonly defaultValue?: T;
}

export function createNodeData<T>(name: string, defaultValue?: T): NodeDataKey<T> {
	return { symbol: Symbol(name), defaultValue };
}

export interface NodeData {
	get<T>(key: NodeDataKey<T>): T | undefined;
	set<T>(key: NodeDataKey<T>, value: T): void;
	expect<T>(key: NodeDataKey<T>): T;
}

// A DOM-shaped element: an EventTarget in a tree that carries state as
// attributes and separates creation from insertion, like the document API.
// Deliberate divergences from the platform, documented in the README:
// - attributes are JsonValue-valued, not strings (they feed renderers)
// - `getAttribute` returns `undefined` for a missing attribute, not `null`
//   (null is a legal attribute VALUE here)
// - `remove()` is terminal — it destroys the subtree and aborts `signal`;
//   there is no detached-but-alive limbo. Reordering uses moves instead:
//   `append`/`insertBefore` relocate an attached node state-preservingly
//   (the DOM's `moveBefore()` semantics).
export interface Node extends EventTarget {
	readonly id: string;
	readonly localName: string;
	readonly attributes: Record<string, JsonValue>;
	readonly children: Iterable<Node>;
	readonly parent: Node | undefined;
	readonly isConnected: boolean;
	readonly data: NodeData;
	// Pseudo-class flags (`'focus'`, `'focus-within'`, ...) — the
	// ElementInternals.states analog, kept out of the author-owned attribute
	// namespace. Convention: authors write attributes; managers (FocusManager,
	// ...) write states; renderers read both. Mutations coalesce into the
	// root's `change` event, like attributes.
	readonly states: Set<string>;
	// Aborts when this node is removed (or the root destroyed). Hand it to
	// anything whose lifetime should match the node's: listeners on ancestors
	// (`{ signal }`), timers, fetch, streams. Cancellation is cooperative.
	readonly signal: AbortSignal;
	getAttribute(name: string): JsonValue | undefined;
	setAttribute(name: string, value: JsonValue): void;
	hasAttribute(name: string): boolean;
	removeAttribute(name: string): void;
	contains(other: Node): boolean;
	append(...nodes: Node[]): void;
	insertBefore(node: Node, reference: Node): void;
	remove(): void;
}

// The document analog: owns the tree, creates (detached) nodes, resolves
// connected nodes by id, and emits a `change` Event (coalesced per microtask)
// whenever the tree may have changed.
export interface Root extends EventTarget {
	readonly documentElement: Node;
	createElement(localName?: string): Node;
	getElementById(id: string): Node | undefined;
	destroy(): void;
}

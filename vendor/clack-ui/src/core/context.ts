import type { Node } from './node.ts';

/**
 * A `Context` defines a value which is in effect for a given {@link Node}.
 *
 * Unless a context value is set for a particular node, it will inherit its
 * value from that node's parent.
 */
export class Context<T> {
	/** A unique identifier for this context. */
	readonly name: string;

	/** The value returned when this context is not present on a node. */
	readonly defaultValue?: T;

	constructor(name: string, defaultValue?: T) {
		this.name = name;
		this.defaultValue = defaultValue;
	}

	get(node: Node): T | undefined {
		for (let n: Node | undefined = node; n; n = n.parent) {
			const contexts = n.contexts;
			if (contexts?.has(this.name)) {
				const value = contexts.get(this.name) as T | undefined;
				return value === undefined ? this.defaultValue : value;
			}
		}
		return this.defaultValue;
	}

	set(node: Node, value: T): void {
		const contexts = (node.contexts ??= new Map());
		contexts.set(this.name, value);
	}

	expect(node: Node): T {
		const value = this.get(node);
		if (value === undefined) {
			throw new MissingContextError(this.name);
		} else {
			return value;
		}
	}

	hasOwn(node: Node): boolean {
		return node.contexts?.has(this.name) ?? false;
	}
}

/**
 * Create a new {@link Context}.
 *
 * @param name - the unique name to give this context.
 * @param defaultValue - the value used when the context is not present on a node.
 * @returns the new context
 */
export function createContext<T>(name: string, defaultValue?: T): Context<T> {
	return new Context(name, defaultValue);
}

export class MissingContextError extends Error {
	constructor(name: string) {
		super(`no value set for context "${name}"`);
		this.name = 'MissingContextError';
	}
}

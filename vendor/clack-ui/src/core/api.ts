import { createContext } from './context.ts';
import type { Node } from './node.ts';

/**
 * The shape every api core must satisfy: each member is a function whose first
 * parameter is the {@link Node} it operates on.
 */
type Core = Record<string, (node: Node, ...args: never[]) => unknown>;
type Signature<F extends Core[string]> = (...args: Parameters<F>) => ReturnType<F>;

/**
 * A function that surrounds a core member, optionally delegating to the next
 * link in the stack.
 *
 * @param args - the member's full parameter tuple, with the node as `args[0]`.
 * @param next - the next link in the chain; accepts the same arguments.
 * @returns a value of the same shape as `next()`'s return value.
 */
export interface Middleware<TArgs extends unknown[], TReturn> {
	(args: TArgs, next: (...args: TArgs) => TReturn): TReturn;
}

/**
 * The set of middlewares that can surround a core `A`. Each member is wrapped
 * by a {@link Middleware} over that member's own signature — node included.
 */
export type Around<A extends Core> = {
	[K in keyof A]: Middleware<Parameters<A[K]>, ReturnType<A[K]>>;
};

export interface Api<A extends Core> {
	/**
	 * Every core member, node-first, with the middleware installed on a node
	 * (and inherited from its ancestors) woven in. `methods.foo(node, ...args)`
	 * is the ergonomic way to call member `foo` on `node`.
	 */
	methods: A;

	/**
	 * Call member `key` as it exists on `args[0]`, threading `args` through every
	 * middleware installed on that node and its ancestors. The first argument is
	 * both the node used to resolve middleware and the node handed to the core.
	 */
	invoke<K extends keyof A>(key: K, args: Parameters<A[K]>): ReturnType<A[K]>;

	/**
	 * Install middleware around this api within `node`. Descendants of `node`
	 * inherit it; ancestors compose outermost.
	 */
	around(node: Node, middlewares: Partial<Around<A>>): void;
}

export function createApi<A extends Core>(name: string, core: A): Api<A> {
	const fields = Object.keys(core) as (keyof A)[];
	const context = createContext<Installed<A>>(`api::${name}`);

	// Merge `inner`'s middlewares into `outer`, combining any key both define so
	// that `outer` wraps `inner`.
	function append(outer: Partial<Around<A>>, inner: Partial<Around<A>>): Partial<Around<A>> {
		const result: Partial<Around<A>> = { ...outer };
		for (const key of Object.keys(inner) as (keyof A)[]) {
			const current = outer[key];
			const decoration = inner[key];
			if (!decoration) continue;
			result[key] = current ? combine([current, decoration]) : decoration;
		}
		return result;
	}

	// Eagerly reify a set of middlewares into a concrete handle: every core member
	// is either wrapped by its middleware or copied through untouched.
	function createHandle(around: Partial<Around<A>>): A {
		// No middlewares at all
		if (Object.keys(around).length === 0) {
			return core;
		} else {
			const handle = { ...core };
			for (const key of fields) {
				const middleware = around[key];
				if (middleware) {
					const member = core[key] as Signature<A[typeof key]>;
					// Preserve the key/signature association erased by the dynamic traversal.
					handle[key] = ((...args: Parameters<A[typeof key]>) =>
						middleware(args, member)) as A[typeof key];
				}
			}
			return handle;
		}
	}

	// Recompute `node`'s handle from the total inherited from its parent, then
	// push the new total down to its children.
	function install(node: Node, total: Partial<Around<A>>): void {
		if (context.hasOwn(node)) {
			const installed = context.expect(node);
			installed.total = total;
			total = append(total, installed.local);
			installed.handle = createHandle(total);
		}
		for (const child of node.children) {
			install(child, total);
		}
	}

	const api: Api<A> = {
		methods: fields.reduce(
			(methods, key) => {
				return Object.assign(methods, {
					[key]: (...args: Parameters<A[typeof key]>) => api.invoke(key, args),
				});
			},
			{ ...core },
		),

		invoke(key, args) {
			const node = args[0];
			const handle = context.get(node)?.handle ?? core;
			const member = handle[key] as Signature<A[typeof key]>;
			return member(...args);
		},

		around(node, middlewares) {
			let current: Installed<A>;
			if (!context.hasOwn(node)) {
				const parent = context.get(node);
				current = {
					total: parent ? append(parent.total, parent.local) : {},
					local: middlewares,
					handle: core,
				};
				context.set(node, current);
			} else {
				current = context.expect(node);
				current.local = append(current.local, middlewares);
			}
			install(node, current.total);
		},
	};

	return api;
}

/**
 * What one node remembers about this api's middleware.
 *
 * - `local`: middleware added to this node directly.
 * - `total`: middleware inherited from its ancestors.
 * - `handle`: the core methods with `total` + `local` already wrapped around
 *   them, so calling a method does no extra work.
 */
interface Installed<A extends Core> {
	local: Partial<Around<A>>;
	total: Partial<Around<A>>;
	handle: A;
}

/** Fold a stack of middlewares into one; the first is outermost. */
function combine<Args extends unknown[], Result>(
	middlewares: Middleware<Args, Result>[],
): Middleware<Args, Result> {
	if (middlewares.length === 0) {
		return (args, next) => next(...args);
	} else {
		return middlewares.reduceRight(
			(next, middleware) => (args, base) =>
				middleware(args, (...innerArgs) => next(innerArgs, base)),
		);
	}
}

import { text as ttyText, type Op } from '@bomb.sh/tty';

/** A rendered node — what a component returns: one op (`text`) or a list of ops (`box`). */
export type Node = Op | Op[];

/** A primitive child. Strings and numbers render as text (`0` and `''` included); `null`, `undefined`, and booleans render nothing — matching React's JSX rules. */
export type Primitive = string | number | boolean | null | undefined;

/** Anything you can pass as a child: a node, a primitive, or a (possibly nested) array of children. */
export type Child = Node | Primitive | Child[];

/**
 * Coerce a primitive child to its text form, or `undefined` if it renders nothing
 * (`null`, `undefined`, or a boolean). Strings and numbers are kept — including `0`
 * and `''` — so this is an explicit nullish/boolean check, not a truthiness test.
 */
export function stringifyPrimitive(value: Primitive): string | undefined {
	if (value == null || typeof value === 'boolean') return undefined;
	return String(value);
}

/**
 * Normalize heterogeneous children into the flat `Op[]` stream the renderer consumes,
 * applying React's JSX coercion rules: strings and numbers become text ops, `null`/
 * `undefined`/booleans drop, arrays flatten recursively, and existing ops pass through.
 */
export function normalizeChildren(children: Child[]): Op[] {
	const ops: Op[] = [];
	// Recurse into one accumulator rather than spreading per level — avoids intermediate
	// arrays and the argument-count ceiling of `push(...arr)` on large flattened lists.
	const walk = (nodes: Child[]): void => {
		for (const child of nodes) {
			if (Array.isArray(child)) {
				walk(child);
			} else if (child !== null && typeof child === 'object') {
				ops.push(child);
			} else {
				const str = stringifyPrimitive(child);
				if (str !== undefined) ops.push(ttyText(str));
			}
		}
	};
	walk(children);
	return ops;
}

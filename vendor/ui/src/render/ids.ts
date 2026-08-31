import type { Op } from '@bomb.sh/tty';

// `@bomb.sh/tty` op directives (OP_OPEN_ELEMENT / OP_CLOSE_ELEMENT); not exported by the package.
const OPEN = 2;
const CLOSE = 4;

/** Separator between key segments in a resolved id path. */
const SEP = '/';

/**
 * Resolve each box's raw segment (its `key`, or `''` when unkeyed) into a full
 * hierarchical id, so `@bomb.sh/tty` keeps element identity stable across renders.
 *
 * The id is the path of segments from the root: a keyed box contributes its key,
 * an unkeyed box falls back to its positional index among siblings. Returns a new
 * op array — the input keeps its raw segments, so re-resolving the same source is
 * idempotent (important when a `box(...)` result is rendered more than once).
 */
export function resolveIds(ops: Op[]): Op[] {
	const stack = [{ path: '', index: 0 }];
	const out: Op[] = [];
	for (const op of ops) {
		if (op.directive === OPEN) {
			const parent = stack[stack.length - 1]!;
			const segment = op.id || String(parent.index);
			parent.index++;
			const path = parent.path ? `${parent.path}${SEP}${segment}` : segment;
			stack.push({ path, index: 0 });
			out.push({ ...op, id: path });
		} else {
			// Keep the root frame so a peek is always safe, even on an unbalanced stream.
			if (op.directive === CLOSE && stack.length > 1) stack.pop();
			out.push(op);
		}
	}
	return out;
}

import { describe, expect, test } from 'vitest';
import { box } from '../components/box.ts';
import { text } from '../components/text.ts';
import { resolveIds } from './ids.ts';

/** Pull the resolved ids off the open ops, in document order. */
function ids(ops: ReturnType<typeof resolveIds>): string[] {
	return ops.filter((op) => op.directive === 2).map((op) => (op as { id: string }).id);
}

describe('resolveIds — hierarchical key paths', () => {
	test('keyed boxes resolve to their parent path + key', () => {
		const ops = box({ key: 'app' }, box({ key: 'sidebar' }), box({ key: 'body' }));
		expect(ids(resolveIds(ops))).toEqual(['app', 'app/sidebar', 'app/body']);
	});

	test('a kept sibling keeps its id when a conditional sibling is dropped', () => {
		const withSidebar = box({ key: 'app' }, box({ key: 'sidebar' }), box({ key: 'body' }));
		const conditionalSidebar = false;
		const withoutSidebar = box(
			{ key: 'app' },
			conditionalSidebar ? box({ key: 'sidebar' }) : null,
			box({ key: 'body' }),
		);
		const bodyId = (resolved: string[]) => resolved.find((id) => id.endsWith('body'));
		expect(bodyId(ids(resolveIds(withSidebar)))).toBe('app/body');
		expect(bodyId(ids(resolveIds(withoutSidebar)))).toBe('app/body');
	});

	test('unkeyed boxes fall back to their positional index among siblings', () => {
		const ops = box({}, box({}), box({}));
		expect(ids(resolveIds(ops))).toEqual(['0', '0/0', '0/1']);
	});

	test('a key overrides the index, but the index slot still advances', () => {
		const ops = box({ key: 'app' }, box({}), box({ key: 'x' }), box({}));
		expect(ids(resolveIds(ops))).toEqual(['app', 'app/0', 'app/x', 'app/2']);
	});

	test('text children do not consume a sibling index slot', () => {
		const ops = box({ key: 'app' }, text({}, 'hi'), box({}));
		expect(ids(resolveIds(ops))).toEqual(['app', 'app/0']);
	});

	test('does not mutate its input — the source keeps its raw key segments', () => {
		const ops = box({ key: 'app' }, box({ key: 'body' }));
		resolveIds(ops);
		// raw segments survive, so re-resolving is idempotent
		expect(ids(ops)).toEqual(['app', 'body']);
		expect(ids(resolveIds(ops))).toEqual(['app', 'app/body']);
	});
});

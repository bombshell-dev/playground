import assert from 'node:assert/strict';
import { createElement as h, type Context, type Element as CrankElement } from '@b9g/crank';
import { describe, expect, it } from 'vitest';
import { Document, Element, Text } from '@bomb.sh/dom';
import { Event } from '@bomb.sh/dom';
import { createRoot } from '../src/index.ts';

describe('actual Crank', () => {
	it('runs generator components, refreshes asynchronously, and cleans up without globals', async () => {
		const documents = [new Document(), new Document()];
		await using first = createRoot(documents[0]!.createElement('box'));
		await using second = createRoot(documents[1]!.createElement('box'));
		const refreshes: Array<() => void> = [];
		const cleanups: number[] = [];
		function* Counter(
			this: Context<{ index: number }>,
			{ index }: { index: number },
		): Generator<CrankElement> {
			let count = 0;
			refreshes[index] = () => {
				count++;
				void this.refresh();
			};
			this.cleanup(() => {
				cleanups.push(index);
			});
			for (const _ of this) yield h('text', null, count);
		}
		await Promise.all([
			first.render(h(Counter, { index: 0 })),
			second.render(h(Counter, { index: 1 })),
		]);
		const original = first.element.firstChild;
		assert.ok(original instanceof Element);
		const content = original.firstChild;
		assert.ok(content instanceof Text);
		await Promise.resolve();
		refreshes[0]?.();
		refreshes[1]?.();
		await expect.poll(() => first.element.textContent).toBe('1');
		await expect.poll(() => second.element.textContent).toBe('1');
		expect(first.element.firstChild).toBe(original);
		expect(original.firstChild).toBe(content);
		expect(content.ownerDocument).toBe(documents[0]);
		expect(second.element.firstChild?.ownerDocument).toBe(documents[1]);
		await first.unmount();
		await second.unmount();
		expect(cleanups).toEqual([0, 1]);
		expect(first.element.childNodes).toHaveLength(0);
		expect(globalThis).not.toHaveProperty('document');
	});

	it('reorders keyed nodes and replaces native event handlers', async () => {
		const document = new Document();
		await using root = createRoot(document.createElement('box'));
		const calls: string[] = [];
		const rows = (names: string[], label: string): CrankElement[] =>
			names.map((name) =>
				h(
					'text',
					{
						key: name,
						onClick: () => calls.push(label),
					},
					name,
				),
			);
		await root.render(rows(['a', 'b', 'c'], 'before'));
		const original = [...root.element.childNodes];
		await root.render(rows(['c', 'a'], 'after'));
		expect(root.element.childNodes).toEqual([original[2], original[0]]);
		root.element.firstChild?.dispatchEvent(new Event('click'));
		expect(calls).toEqual(['after']);
	});
});

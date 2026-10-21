import assert from 'node:assert/strict';
import { createElement as h, createRef, useEffect, useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Document, Element, Text } from '@bomb.sh/dom';
import { Event } from '@bomb.sh/dom';
import { createPortal, createRoot } from '../src/index.ts';

describe('actual React reconciler', () => {
	it('rejects a failed render and can subsequently mount a healthy tree', async () => {
		const document = new Document();
		using root = createRoot(document.createElement('box'));
		const failure = new RangeError('component failed');
		function Failing(): never {
			throw failure;
		}
		await expect(root.render(h(Failing))).rejects.toBe(failure);
		await root.render(h('text', null, 'recovered'));
		expect(root.element.textContent).toBe('recovered');
	});

	it('updates two documents asynchronously, preserves refs/text, and cleans up effects', async () => {
		const firstDocument = new Document();
		const secondDocument = new Document();
		const firstContainer = firstDocument.createElement('box');
		const secondContainer = secondDocument.createElement('box');
		using first = createRoot(firstContainer);
		using second = createRoot(secondContainer);
		const setters: Array<(value: number) => void> = [];
		const cleanups: number[] = [];
		const firstRef = createRef<Element>();
		function Counter({ index }: { index: number }): ReactElement {
			const [value, setValue] = useState(0);
			setters[index] = setValue;
			useEffect(
				() => () => {
					cleanups.push(index);
				},
				[],
			);
			return h('text', { ref: index === 0 ? firstRef : undefined }, value);
		}
		await Promise.all([
			first.render(h(Counter, { index: 0 })),
			second.render(h(Counter, { index: 1 })),
		]);
		const firstElement = firstContainer.firstChild;
		assert.ok(firstElement instanceof Element);
		const firstText = firstElement.firstChild;
		assert.ok(firstText instanceof Text);
		expect(firstRef.current).toBe(firstElement);
		await Promise.resolve();
		setters[0]?.(1);
		setters[1]?.(2);
		await expect.poll(() => firstContainer.textContent).toBe('1');
		await expect.poll(() => secondContainer.textContent).toBe('2');
		expect(firstContainer.firstChild).toBe(firstElement);
		expect(firstElement.firstChild).toBe(firstText);
		expect(firstText.ownerDocument).toBe(firstDocument);
		expect(secondContainer.firstChild?.ownerDocument).toBe(secondDocument);
		first.unmount();
		second.unmount();
		expect(firstRef.current).toBeNull();
		expect(cleanups).toEqual([0, 1]);
		expect(globalThis).not.toHaveProperty('document');
	});

	it('reorders keyed native nodes, replaces event handlers, and owns cross-document portals', async () => {
		const document = new Document();
		const remoteDocument = new Document();
		const container = document.createElement('box');
		const remote = remoteDocument.createElement('box');
		using root = createRoot(container);
		const calls: string[] = [];
		const rows = (names: string[], label: string): ReactElement[] =>
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
		const original = [...container.childNodes];
		await root.render(rows(['c', 'a'], 'after'));
		expect(container.childNodes).toEqual([original[2], original[0]]);
		container.firstChild?.dispatchEvent(new Event('click'));
		expect(calls).toEqual(['after']);
		await root.render(createPortal(h('text', null, 'remote'), remote));
		expect(remote.textContent).toBe('remote');
		expect(remote.firstChild?.ownerDocument).toBe(remoteDocument);
		root.unmount();
		expect(remote.childNodes).toHaveLength(0);
	});
});

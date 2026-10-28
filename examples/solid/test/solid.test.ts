import { createSignal, onCleanup } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { Document, type Element } from '@bomb.sh/dom';
import { Event } from '@bomb.sh/dom';
import { createSolidRenderer } from '../src/index.ts';

describe('actual Solid universal renderer', () => {
	it('keeps independent reactive roots and text nodes in their documents without globals', async () => {
		const documents = [new Document(), new Document()];
		const containers = documents.map((document) => document.createElement('box'));
		const setters: Array<(value: string) => void> = [];
		const cleanups: number[] = [];
		const disposers = documents.map((document, index) => {
			const renderer = createSolidRenderer(document);
			return renderer.render(() => {
				const [value, setValue] = createSignal('initial');
				setters.push(setValue);
				onCleanup(() => {
					cleanups.push(index);
				});
				const node = renderer.createElement('text');
				renderer.insert(node, value);
				return node;
			}, containers[index]!);
		});
		const original = containers.map((container) => container.firstChild?.firstChild);
		await Promise.resolve();
		setters[0]?.('first');
		setters[1]?.('second');
		expect(containers.map((container) => container.textContent)).toEqual(['first', 'second']);
		for (const [index, container] of containers.entries()) {
			expect(container.firstChild?.firstChild).toBe(original[index]);
			expect(container.firstChild?.ownerDocument).toBe(documents[index]);
		}
		for (const dispose of disposers) dispose();
		expect(cleanups).toEqual([0, 1]);
		expect(containers.every((container) => container.childNodes.length === 0)).toBe(true);
		expect(globalThis).not.toHaveProperty('document');
	});

	it('reorders node identities and updates native handlers through real reactive effects', () => {
		const document = new Document();
		const container = document.createElement('box');
		const renderer = createSolidRenderer(document);
		const calls: string[] = [];
		const original = ['a', 'b', 'c'].map((name) => {
			const element = document.createElement('text');
			element.textContent = name;
			return element;
		});
		let changeOrder = (_value: Element[]): void => {};
		const dispose = renderer.render(() => {
			const [order, setOrder] = createSignal(original);
			changeOrder = setOrder;
			const parent = renderer.createElement('box');
			renderer.insert(parent, order);
			renderer.setProp(original[0]!, 'onClick', () => calls.push('clicked'));
			return parent;
		}, container);
		changeOrder([original[2]!, original[0]!]);
		expect(container.firstChild?.childNodes).toEqual([original[2], original[0]]);
		original[0]?.dispatchEvent(new Event('click'));
		expect(calls).toEqual(['clicked']);
		dispose();
	});
});

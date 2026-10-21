// Adapted regression cases from @clack/ui-preact at
// 606675f16131c6ae7c4553a67ab477bdf661f772.
// Copyright (c) 2025-Present Bombshell contributors. MIT license; see LICENSE.
import assert from 'node:assert/strict';
import { createPortal, createRef, h, type ContainerNode, type VNode, type Ref } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Document, Element, Text, type Node } from '@bomb.sh/dom';
import { Event } from '@bomb.sh/dom';
import { createRoot } from '../src/index.ts';
import type { JSX } from '../src/jsx-runtime.ts';

function element(node: Node | null): Element {
	assert.ok(node instanceof Element);
	return node;
}

function text(node: Node | null): Text {
	assert.ok(node instanceof Text);
	return node;
}

function connectedRoot(document: Document): Element {
	return document.appendChild(document.createElement('document'));
}

describe('actual Preact 11', () => {
	it('mounts into any existing container without altering siblings or installing globals', () => {
		expect(globalThis).not.toHaveProperty('document');
		const document = new Document();
		const parent = connectedRoot(document);
		const before = document.createTextNode('before');
		const container = document.createElement('box');
		const after = document.createTextNode('after');
		parent.appendChild(before);
		parent.appendChild(container);
		parent.appendChild(after);
		using root = createRoot(container);
		const ref = createRef<Element>();
		root.render(h('text', { ref }, 'hello'));
		const output = element(container.firstChild);
		expect(output.localName).toBe('text');
		expect(output.ownerDocument).toBe(document);
		expect(ref.current).toBe(output);
		expect(text(output.firstChild).data).toBe('hello');
		root.unmount();
		expect(ref.current).toBeNull();
		expect(parent.childNodes).toEqual([before, container, after]);
		expect(container.childNodes).toHaveLength(0);
		expect(globalThis).not.toHaveProperty('document');
	});

	it('prepares detached trees without invalidation, then updates text identity and attributes', () => {
		const notify = vi.fn();
		const document = new Document({ onInvalidate: notify });
		const container = document.createElement('box');
		using root = createRoot(container);
		root.render(h('text', { 'data-state': 'before' }, 'hello'));
		const output = element(container.firstChild);
		const content = text(output.firstChild);
		expect(notify).not.toHaveBeenCalled();
		document.appendChild(container);
		expect(notify).toHaveBeenCalled();
		root.render(h('text', { 'data-state': 'after' }, 42));
		expect(container.firstChild).toBe(output);
		expect(output.firstChild).toBe(content);
		expect(content.data).toBe('42');
		expect(output.getAttribute('data-state')).toBe('after');
	});

	it('updates independent documents asynchronously through their own ownerDocument', async () => {
		const firstDocument = new Document();
		const secondDocument = new Document();
		using first = createRoot(connectedRoot(firstDocument));
		using second = createRoot(connectedRoot(secondDocument));
		const updates: Array<(value: number) => void> = [];
		function Counter({ index }: { index: number }): VNode {
			const [count, setCount] = useState(0);
			updates[index] = setCount;
			return h(count ? 'box' : 'text', null, count || 'initial');
		}
		first.render(h(Counter, { index: 0 }));
		second.render(h(Counter, { index: 1 }));
		await act(() => {
			updates[0]?.(1);
			updates[1]?.(2);
		});
		const firstChild = element(first.element.firstChild);
		const secondChild = element(second.element.firstChild);
		expect(firstChild.ownerDocument).toBe(firstDocument);
		expect(text(firstChild.firstChild).ownerDocument).toBe(firstDocument);
		expect(text(firstChild.firstChild).data).toBe('1');
		expect(secondChild.ownerDocument).toBe(secondDocument);
		expect(text(secondChild.firstChild).ownerDocument).toBe(secondDocument);
		expect(text(secondChild.firstChild).data).toBe('2');
		expect(globalThis).not.toHaveProperty('document');
	});

	it('registers capture handlers and replaces/removes handlers without changing event names', () => {
		const document = new Document();
		using root = createRoot(connectedRoot(document));
		const calls: string[] = [];
		root.render(
			h(
				'box',
				{ onKeyDownCapture: () => calls.push('capture') },
				h('text', { onKeyDown: (event: Event) => calls.push(event.type) }, 'target'),
			),
		);
		const target = element(element(root.element.firstChild).firstChild);
		target.dispatchEvent(new Event('keydown', { bubbles: true }));
		expect(calls).toEqual(['capture', 'keydown']);
		root.render(
			h('box', null, h('text', { onKeyDown: () => calls.push('replacement') }, 'target')),
		);
		target.dispatchEvent(new Event('keydown', { bubbles: true }));
		expect(calls).toEqual(['capture', 'keydown', 'replacement']);
		root.render(h('box', null, h('text', { onionChange: () => calls.push('custom') }, 'target')));
		target.dispatchEvent(new Event('keydown', { bubbles: true }));
		target.dispatchEvent(new Event('ionchange'));
		target.dispatchEvent(new Event('ionChange'));
		expect(calls).toEqual(['capture', 'keydown', 'replacement', 'custom']);
	});

	it('preserves keyed nodes and cleans up layout effects on removal and disposal', () => {
		const document = new Document();
		const container = connectedRoot(document);
		const cleanups: string[] = [];
		function Row({ name }: { name: string }): VNode {
			useLayoutEffect(
				() => () => {
					cleanups.push(name);
				},
				[],
			);
			return h('text', null, name);
		}
		{
			using root = createRoot(container);
			root.render(['a', 'b', 'c'].map((name) => h(Row, { key: name, name })));
			const original = [...container.childNodes];
			root.render(['c', 'a'].map((name) => h(Row, { key: name, name })));
			expect(container.childNodes).toEqual([original[2], original[0]]);
			expect(original[1]?.parentNode).toBeNull();
			expect(cleanups).toEqual(['b']);
		}
		expect(container.childNodes).toHaveLength(0);
		expect(cleanups).toEqual(['b', 'c', 'a']);
	});

	it('creates portals in the destination document and removes them on unmount', () => {
		const document = new Document();
		const destination = new Document();
		const remoteContainer = connectedRoot(destination);
		using root = createRoot(connectedRoot(document));
		root.render(h('box', null, 'local', createPortal(h('text', null, 'remote'), remoteContainer)));
		const remote = element(remoteContainer.firstChild);
		expect(remote.ownerDocument).toBe(destination);
		expect(text(remote.firstChild).ownerDocument).toBe(destination);
		expect(remote.textContent).toBe('remote');
		root.unmount();
		expect(root.element.childNodes).toHaveLength(0);
		expect(remoteContainer.childNodes).toHaveLength(0);
	});

	it('accepts public host types without application casts or browser declarations', () => {
		expectTypeOf<Element>().toExtend<ContainerNode>();
		expectTypeOf<JSX.IntrinsicElements['box']['ref']>().toEqualTypeOf<Ref<Element> | undefined>();
		expectTypeOf<NonNullable<JSX.IntrinsicElements['box']['onKeyDown']>>()
			.parameter(0)
			.toEqualTypeOf<Event>();
	});
});

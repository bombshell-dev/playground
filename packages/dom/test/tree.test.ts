import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { Document, Element, HTML_NAMESPACE, SVG_NAMESPACE } from '../src/dom.ts';
import { Event } from '../src/events.ts';
import { MutationObserver } from '../src/observation.ts';

describe('tree and ownership invariants', () => {
	it('rejects invalid document fragments before changing either tree or notifying', () => {
		const notify = vi.fn();
		const source = new Document();
		const destination = new Document({ onInvalidate: notify });
		const fragment = source.createDocumentFragment();
		const first = source.createElement('first');
		const second = source.createElement('second');
		fragment.append(first, second);
		const observer = new MutationObserver(() => {});
		observer.observe(fragment, { childList: true });
		expect(() => destination.appendChild(fragment)).toThrowError(
			expect.objectContaining({ name: 'HierarchyRequestError' }),
		);
		expect(fragment.childNodes).toEqual([first, second]);
		expect(destination.childNodes).toHaveLength(0);
		expect(first.ownerDocument).toBe(source);
		expect(first.parentNode).toBe(fragment);
		expect(observer.takeRecords()).toEqual([]);
		expect(notify).not.toHaveBeenCalled();
		observer.disconnect();
	});

	it('rejects cycles and wrong anchors before moving a connected subtree', () => {
		const document = new Document();
		const root = document.appendChild(document.createElement('box'));
		const branch = root.appendChild(document.createElement('branch'));
		const child = branch.appendChild(document.createElement('child'));
		const detached = document.createElement('detached');
		expect(() => detached.insertBefore(branch, child)).toThrowError(
			expect.objectContaining({ name: 'NotFoundError' }),
		);
		expect(() => child.insertBefore(branch, null)).toThrowError(
			expect.objectContaining({ name: 'HierarchyRequestError' }),
		);
		expect(() => branch.appendChild(branch)).toThrowError(
			expect.objectContaining({ name: 'HierarchyRequestError' }),
		);
		expect(branch.parentNode).toBe(root);
		expect(child.parentNode).toBe(branch);
		expect(detached.childNodes).toHaveLength(0);
	});

	it('adopts descendants and attributes without losing identity, listeners, or user state', () => {
		const source = new Document();
		const destination = new Document();
		const root = source.appendChild(source.createElement('root'));
		const branch = root.appendChild(source.createElement('branch'));
		branch.setAttribute('data-state', 'before');
		const attr = branch.getAttributeNode('data-state');
		const text = branch.appendChild(source.createTextNode('value'));
		const listener = vi.fn();
		branch.addEventListener('customName', listener);
		const state = { selected: true };
		Reflect.set(branch, 'userState', state);
		destination.appendChild(branch);
		expect(branch.ownerDocument).toBe(destination);
		expect(text.ownerDocument).toBe(destination);
		expect(attr?.ownerDocument).toBe(destination);
		expect(attr?.ownerElement).toBe(branch);
		expect(Reflect.get(branch, 'userState')).toBe(state);
		branch.dispatchEvent(new Event('customName'));
		expect(listener).toHaveBeenCalledOnce();
		expect(root.childNodes).toHaveLength(0);
	});

	it('exposes collections which cannot mutate the tree behind its invariants', () => {
		const document = new Document();
		const root = document.createElement('box');
		const child = root.appendChild(document.createElement('text'));
		expect(Reflect.set(root.childNodes, '0', document.createTextNode('replacement'))).toBe(false);
		expect(Reflect.set(root.children, 'length', 0)).toBe(false);
		root.setAttribute('title', 'kept');
		expect(Reflect.set(root.attributes, 'length', 0)).toBe(false);
		expect(root.firstChild).toBe(child);
		expect(child.parentNode).toBe(root);
		expect(root.getAttribute('title')).toBe('kept');
	});

	it('treats attributes and character data as leaf nodes', () => {
		const document = new Document();
		const parent = document.createElement('box');
		const child = parent.appendChild(document.createElement('text'));
		for (const leaf of [
			document.createAttribute('title'),
			document.createTextNode('hello'),
			document.createComment('comment'),
		]) {
			expect(() => leaf.appendChild(child)).toThrowError(
				expect.objectContaining({ name: 'HierarchyRequestError' }),
			);
			expect(child.parentNode).toBe(parent);
		}
	});

	it('preserves case in createElementNS, including the HTML namespace', () => {
		const document = new Document();
		expect(document.createElement('MixedCase').localName).toBe('mixedcase');
		expect(document.createElementNS(HTML_NAMESPACE, 'MixedCase').localName).toBe('MixedCase');
		const svg = document.createElementNS(SVG_NAMESPACE, 'linearGradient');
		expect(svg.localName).toBe('linearGradient');
		expect(svg.nodeName).toBe('linearGradient');
		svg.setAttribute('viewBox', '0 0 1 1');
		expect(svg.getAttribute('viewbox')).toBeNull();
		expect(svg.cloneNode()).toBeInstanceOf(Element);
		expect(svg.cloneNode().nodeName).toBe('linearGradient');
	});

	it('replaces attribute nodes by namespace and local name for both setters', () => {
		const document = new Document();
		const element = document.createElement('box');
		const first = document.createAttributeNS('urn:test', 'first:name');
		const second = document.createAttributeNS('urn:test', 'second:name');
		first.value = 'first';
		second.value = 'second';
		element.setAttributeNode(first);
		expect(element.setAttributeNode(second)).toBe(first);
		expect(first.ownerElement).toBeNull();
		expect(second.ownerElement).toBe(element);
		expect(element.attributes).toHaveLength(1);
		expect(element.getAttributeNS('urn:test', 'name')).toBe('second');
	});

	it('rejects an attribute owned by another element without changing either owner', () => {
		const document = new Document();
		const first = document.createElement('first');
		const second = document.createElement('second');
		first.setAttribute('title', 'first');
		second.setAttribute('title', 'second');
		const attr = first.getAttributeNode('title');
		assert.ok(attr);
		expect(() => second.setAttributeNode(attr)).toThrowError(
			expect.objectContaining({ name: 'InUseAttributeError' }),
		);
		expect(attr.ownerElement).toBe(first);
		expect(second.getAttribute('title')).toBe('second');
	});

	it('records one fragment removal and one parent insertion for fragment transfer', () => {
		const document = new Document();
		const parent = document.createElement('box');
		const fragment = document.createDocumentFragment();
		const first = fragment.appendChild(document.createElement('first'));
		const second = fragment.appendChild(document.createElement('second'));
		const observer = new MutationObserver(() => {});
		observer.observe(fragment, { childList: true });
		observer.observe(parent, { childList: true });
		parent.appendChild(fragment);
		const records = observer.takeRecords();
		expect(records).toHaveLength(2);
		expect(records[0]?.target).toBe(fragment);
		expect(records[0]?.removedNodes).toEqual([first, second]);
		expect(records[1]?.target).toBe(parent);
		expect(records[1]?.addedNodes).toEqual([first, second]);
		observer.disconnect();
	});

	it('keeps an element in place when replaced with itself', () => {
		const document = new Document();
		const parent = document.createElement('box');
		const child = parent.appendChild(document.createElement('text'));
		child.replaceWith(child);
		expect(child.parentNode).toBe(parent);
		expect(parent.firstChild).toBe(child);
	});

	it('prepends an existing first child followed by another existing child in argument order', () => {
		const document = new Document();
		const parent = document.createElement('box');
		const first = parent.appendChild(document.createElement('first'));
		const middle = parent.appendChild(document.createElement('middle'));
		const last = parent.appendChild(document.createElement('last'));
		parent.prepend(first, last);
		expect(parent.childNodes).toEqual([first, last, middle]);
	});
});

it('aggregates replacement records while retaining transient subtree observers', () => {
	const document = new Document();
	const parent = document.createElement('box');
	const a = document.createElement('a');
	const b = document.createElement('b');
	parent.append(a, b);
	const observer = new MutationObserver(() => {});
	observer.observe(parent, { childList: true, subtree: true, attributes: true });
	parent.textContent = 'replacement';
	a.setAttribute('detached', 'yes');
	const records = observer.takeRecords();
	expect(records).toHaveLength(2);
	expect(records[0]?.removedNodes).toEqual([a, b]);
	expect(records[0]?.addedNodes[0]?.textContent).toBe('replacement');
	expect(records[1]?.target).toBe(a);
	const replacement = document.createElement('next');
	observer.takeRecords();
	parent.replaceChild(replacement, parent.firstChild!);
	const replaced = observer.takeRecords();
	expect(replaced).toHaveLength(1);
	expect(replaced[0]?.addedNodes).toEqual([replacement]);
	expect(replaced[0]?.removedNodes).toHaveLength(1);
});

it('keeps held child and attribute collections live without exposing mutation arrays', () => {
	const document = new Document();
	const root = document.createElement('box');
	const nodes = root.childNodes;
	const attrs = root.attributes;
	const text = document.createTextNode('a');
	root.appendChild(text);
	root.setAttribute('id', 'example');
	expect(nodes).toBe(root.childNodes);
	expect(nodes[0]).toBe(text);
	expect(nodes.length).toBe(1);
	expect(attrs[0]?.value).toBe('example');
	expect(Reflect.set(nodes, '0', document.createTextNode('bad'))).toBe(false);
	expect(Reflect.deleteProperty(nodes, '0')).toBe(false);
	expect(Reflect.defineProperty(attrs, '0', { value: null })).toBe(false);
	expect(() => Array.prototype.pop.call(nodes)).toThrow();
	root.removeChild(text);
	root.removeAttribute('id');
	expect(nodes.length).toBe(0);
	expect(attrs.length).toBe(0);
});

it('uses WebIDL unsigned offsets and counts for UTF-16 character data', () => {
	const document = new Document();
	const text = document.createTextNode('a😀bc');
	expect(text.substringData(1.8, 2.9)).toBe('😀');
	text.replaceData(Number.NaN, 0, 'x');
	expect(text.data).toBe('xa😀bc');
	text.deleteData(2, -1);
	expect(text.data).toBe('xa');
	expect(() => text.deleteData(-1, 1)).toThrow();
	expect(text.splitText(1.9).data).toBe('a');
	expect(text.data).toBe('x');
});

it('rejects a variadic invalid document shape before moving either source node', () => {
	const document = new Document();
	const source = document.createElement('box');
	const a = document.createElement('a');
	const b = document.createElement('b');
	source.append(a, b);
	expect(() => document.append(a, b)).toThrow();
	expect(source.childNodes).toEqual([a, b]);
	expect(document.childNodes.length).toBe(0);
	expect(() => document.prepend(a, b)).toThrow();
	expect(source.childNodes).toEqual([a, b]);
});

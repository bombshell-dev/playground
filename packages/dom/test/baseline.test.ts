// Adapted from @clack/ui baseline 606675f16131c6ae7c4553a67ab477bdf661f772.
// Copyright (c) 2025-Present Bombshell contributors. MIT; see LICENSE.
import { describe, expect, it, vi } from 'vitest';
import { Document, type Element, type Node, type Text } from '../src/dom.ts';
import { Event } from '../src/events.ts';

function documentWithRoot(notify: () => void): Document & { root: Element } {
	const document = new Document();
	const root = document.createElement('document');
	document.appendChild(root);
	document.invalidate = () => notify();
	return Object.assign(document, { root });
}

describe('DOM connectivity', () => {
	it('preserves a subtree through connection, disconnection, and reconnection', () => {
		const notify = vi.fn();
		const document = documentWithRoot(notify);
		const root = document.root;
		const branch = document.createElement('div');
		const span = document.createElement('span');
		const text = document.createTextNode('initial');

		expect(root.isConnected).toBe(true);
		expect(branch.isConnected).toBe(false);
		expect(span.isConnected).toBe(false);
		expect(text.isConnected).toBe(false);
		expect(branch.parentNode).toBeNull();

		branch.appendChild(span);
		span.appendChild(text);
		text.data = 'prepared';
		branch.setAttribute('data-state', 'prepared');

		expect(span.parentNode).toBe(branch);
		expect(text.parentNode).toBe(span);
		expect(branch.isConnected).toBe(false);
		expect(span.isConnected).toBe(false);
		expect(text.isConnected).toBe(false);
		expect(text.data).toBe('prepared');
		expect(branch.attributes[0]).toMatchObject({ name: 'data-state', value: 'prepared' });
		expect(notify).not.toHaveBeenCalled();

		root.appendChild(branch);

		expect(root.childNodes).toHaveLength(1);
		expect(root.childNodes[0]).toBe(branch);
		expect(branch.parentNode).toBe(root);
		expect(branch.isConnected).toBe(true);
		expect(span.isConnected).toBe(true);
		expect(text.isConnected).toBe(true);
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		text.data = 'connected';
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		branch.setAttribute('data-state', 'connected');
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		const extra = document.createTextNode('!');
		span.appendChild(extra);
		expect(extra.isConnected).toBe(true);
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		root.removeChild(branch);

		expect(root.childNodes).toHaveLength(0);
		expect(branch.parentNode).toBeNull();
		expect(span.parentNode).toBe(branch);
		expect(text.parentNode).toBe(span);
		expect(branch.isConnected).toBe(false);
		expect(span.isConnected).toBe(false);
		expect(text.isConnected).toBe(false);
		expect(extra.isConnected).toBe(false);
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		text.data = 'detached';
		branch.removeAttribute('data-state');
		span.removeChild(extra);

		expect(extra.parentNode).toBeNull();
		expect(span.childNodes).toHaveLength(1);
		expect(span.childNodes[0]).toBe(text);
		expect(text.data).toBe('detached');
		expect(branch.attributes).toHaveLength(0);
		expect(notify).not.toHaveBeenCalled();

		root.appendChild(branch);

		expect(root.childNodes).toHaveLength(1);
		expect(root.childNodes[0]).toBe(branch);
		expect(branch.parentNode).toBe(root);
		expect(branch.isConnected).toBe(true);
		expect(span.isConnected).toBe(true);
		expect(text.isConnected).toBe(true);
		expect(extra.isConnected).toBe(false);
		expect(text.data).toBe('detached');
		expect(branch.attributes).toHaveLength(0);
		expect(notify).toHaveBeenCalled();
	});

	it('moves a subtree between detached parents without notifying', () => {
		const notify = vi.fn();
		const document = documentWithRoot(notify);
		const source = document.createElement('div');
		const destination = document.createElement('div');
		const branch = document.createElement('span');
		const text = document.createTextNode('before');
		branch.appendChild(text);
		source.appendChild(branch);
		notify.mockClear();

		destination.appendChild(branch);

		expect(source.childNodes).toHaveLength(0);
		expect(destination.childNodes).toHaveLength(1);
		expect(destination.childNodes[0]).toBe(branch);
		expect(branch.parentNode).toBe(destination);
		expect(branch.childNodes).toHaveLength(1);
		expect(branch.childNodes[0]).toBe(text);
		expect(text.parentNode).toBe(branch);
		expect(source.isConnected).toBe(false);
		expect(destination.isConnected).toBe(false);
		expect(branch.isConnected).toBe(false);
		expect(text.isConnected).toBe(false);
		expect(notify).not.toHaveBeenCalled();

		text.data = 'after';
		expect(notify).not.toHaveBeenCalled();

		branch.setAttribute('data-state', 'after');
		expect(notify).not.toHaveBeenCalled();
	});

	it('connects a detached subtree and starts notifying when moved into a connected parent', () => {
		const notify = vi.fn();
		const document = documentWithRoot(notify);
		const source = document.createElement('div');
		const destination = document.createElement('div');
		const branch = document.createElement('span');
		const text = document.createTextNode('before');
		branch.appendChild(text);
		source.appendChild(branch);
		document.root.appendChild(destination);
		notify.mockClear();

		destination.appendChild(branch);

		expect(source.childNodes).toHaveLength(0);
		expect(destination.childNodes).toHaveLength(1);
		expect(destination.childNodes[0]).toBe(branch);
		expect(branch.parentNode).toBe(destination);
		expect(branch.childNodes).toHaveLength(1);
		expect(branch.childNodes[0]).toBe(text);
		expect(text.parentNode).toBe(branch);
		expect(source.isConnected).toBe(false);
		expect(destination.isConnected).toBe(true);
		expect(branch.isConnected).toBe(true);
		expect(text.isConnected).toBe(true);
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		text.data = 'after';
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		branch.setAttribute('data-state', 'after');
		expect(notify).toHaveBeenCalled();
	});

	it('notifies removal and stops notifying when a subtree moves into a detached parent', () => {
		const notify = vi.fn();
		const document = documentWithRoot(notify);
		const source = document.createElement('div');
		const destination = document.createElement('div');
		const branch = document.createElement('span');
		const text = document.createTextNode('before');
		branch.appendChild(text);
		source.appendChild(branch);
		document.root.appendChild(source);
		notify.mockClear();

		destination.appendChild(branch);

		expect(source.childNodes).toHaveLength(0);
		expect(destination.childNodes).toHaveLength(1);
		expect(destination.childNodes[0]).toBe(branch);
		expect(branch.parentNode).toBe(destination);
		expect(branch.childNodes).toHaveLength(1);
		expect(branch.childNodes[0]).toBe(text);
		expect(text.parentNode).toBe(branch);
		expect(source.isConnected).toBe(true);
		expect(destination.isConnected).toBe(false);
		expect(branch.isConnected).toBe(false);
		expect(text.isConnected).toBe(false);
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		text.data = 'after';
		expect(notify).not.toHaveBeenCalled();

		branch.setAttribute('data-state', 'after');
		expect(notify).not.toHaveBeenCalled();
	});

	it('keeps a subtree connected and notifying when moved between connected parents', () => {
		const notify = vi.fn();
		const document = documentWithRoot(notify);
		const source = document.createElement('div');
		const destination = document.createElement('div');
		const branch = document.createElement('span');
		const text = document.createTextNode('before');
		branch.appendChild(text);
		source.appendChild(branch);
		document.root.appendChild(source);
		document.root.appendChild(destination);
		notify.mockClear();

		destination.appendChild(branch);

		expect(source.childNodes).toHaveLength(0);
		expect(destination.childNodes).toHaveLength(1);
		expect(destination.childNodes[0]).toBe(branch);
		expect(branch.parentNode).toBe(destination);
		expect(branch.childNodes).toHaveLength(1);
		expect(branch.childNodes[0]).toBe(text);
		expect(text.parentNode).toBe(branch);
		expect(source.isConnected).toBe(true);
		expect(destination.isConnected).toBe(true);
		expect(branch.isConnected).toBe(true);
		expect(text.isConnected).toBe(true);
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		text.data = 'after';
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		branch.setAttribute('data-state', 'after');
		expect(notify).toHaveBeenCalled();
	});

	it('moves an existing child to the end without duplicating it', () => {
		const notify = vi.fn();
		const document = documentWithRoot(notify);
		const root = document.root;
		const first = document.createTextNode('first');
		const second = document.createTextNode('second');
		root.appendChild(first);
		root.appendChild(second);
		notify.mockClear();

		root.appendChild(first);

		expect(root.childNodes).toHaveLength(2);
		expect(root.childNodes[0]).toBe(second);
		expect(root.childNodes[1]).toBe(first);
		expect(first.parentNode).toBe(root);
		expect(second.parentNode).toBe(root);
		expect(first.isConnected).toBe(true);
		expect(second.isConnected).toBe(true);
		expect(notify).toHaveBeenCalled();
	});

	it('rejects cycles and removal from the wrong parent without changing the tree', () => {
		const notify = vi.fn();
		const document = documentWithRoot(notify);
		const root = document.root;
		const parent = document.createElement('div');
		const other = document.createElement('div');
		const child = document.createElement('span');
		parent.appendChild(child);
		root.appendChild(parent);
		root.appendChild(other);
		notify.mockClear();

		for (const mutate of [
			() => child.appendChild(parent),
			() => parent.appendChild(parent),
			() => other.removeChild(child),
		]) {
			expect(mutate).toThrow();

			expect(root.childNodes).toHaveLength(2);
			expect(root.childNodes[0]).toBe(parent);
			expect(root.childNodes[1]).toBe(other);
			expect(parent.parentNode).toBe(root);
			expect(other.parentNode).toBe(root);
			expect(parent.childNodes).toHaveLength(1);
			expect(parent.childNodes[0]).toBe(child);
			expect(child.parentNode).toBe(parent);
			expect(child.childNodes).toHaveLength(0);
			expect(other.childNodes).toHaveLength(0);
			expect(notify).not.toHaveBeenCalled();
		}
	});
});

describe('createElementNS', () => {
	it('creates HTML elements and text with the metadata used to match existing nodes', () => {
		const document = documentWithRoot(vi.fn());
		const namespace = 'http://www.w3.org/1999/xhtml';
		const div = document.createElementNS(namespace, 'div');
		const span = document.createElement('span');
		const text = document.createTextNode('hello');

		expect(document.root.ownerDocument).toBe(document);
		expect(document.root.namespaceURI).toBe(namespace);
		expect(document.root.nodeType).toBe(1);
		expect(div.ownerDocument).toBe(document);
		expect(div.namespaceURI).toBe(namespace);
		expect(div.localName).toBe('div');
		expect(div.nodeName).toBe('DIV');
		expect(div.nodeType).toBe(1);
		expect(div.parentNode).toBeNull();
		expect(div.isConnected).toBe(false);
		expect(span.namespaceURI).toBe(namespace);
		expect(span.localName).toBe('span');
		expect(text.ownerDocument).toBe(document);
		expect(text.nodeName).toBe('#text');
		expect(text.nodeType).toBe(3);
		expect(text.firstChild).toBeNull();
		expect(text.nextSibling).toBeNull();
	});
});

describe('createTextNode / data', () => {
	it('coerces numeric text to strings and updates or clears it without replacing the node', () => {
		const notify = vi.fn();
		const document = documentWithRoot(notify);
		// Preact passes numbers directly from JavaScript, despite the DOM's string signature.
		const text: Text = Reflect.apply(document.createTextNode, document, [42]);

		expect(text.data).toBe('42');
		expect(notify).not.toHaveBeenCalled();
		document.root.appendChild(text);
		notify.mockClear();

		Reflect.set(text, 'data', 43n);

		expect(text.data).toBe('43');
		expect(document.root.childNodes[0]).toBe(text);
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		text.data = '43';
		expect(notify).not.toHaveBeenCalled();

		text.data = '';
		expect(text.data).toBe('');
		expect(document.root.childNodes).toHaveLength(1);
		expect(document.root.childNodes[0]).toBe(text);
		expect(notify).toHaveBeenCalled();
	});
});

describe('insertBefore', () => {
	it('inserts before an anchor and appends with a null anchor', () => {
		const notify = vi.fn();
		const document = documentWithRoot(notify);
		const parent = document.createElement('div');
		const first = document.createTextNode('first');
		const middle = document.createElement('span');
		const last = document.createTextNode('last');

		expect(parent.firstChild).toBeNull();
		expect(parent.insertBefore(last, null)).toBe(last);
		expect(parent.insertBefore(first, last)).toBe(first);
		expect(parent.insertBefore(middle, last)).toBe(middle);

		expect(parent.childNodes).toHaveLength(3);
		expect(parent.childNodes[0]).toBe(first);
		expect(parent.childNodes[1]).toBe(middle);
		expect(parent.childNodes[2]).toBe(last);
		expect(parent.firstChild).toBe(first);
		expect(first.nextSibling).toBe(middle);
		expect(middle.nextSibling).toBe(last);
		expect(last.nextSibling).toBeNull();
		expect(first.parentNode).toBe(parent);
		expect(middle.parentNode).toBe(parent);
		expect(last.parentNode).toBe(parent);
		expect(parent.children).toHaveLength(1);
		expect(parent.children[0]).toBe(middle);
		expect(notify).not.toHaveBeenCalled();
	});

	it('reorders existing children in both directions without duplicating them', () => {
		const notify = vi.fn();
		const document = documentWithRoot(notify);
		const parent = document.root;
		const first = document.createElement('span');
		const middle = document.createTextNode('middle');
		const last = document.createElement('span');
		parent.appendChild(first);
		parent.appendChild(middle);
		parent.appendChild(last);
		notify.mockClear();

		parent.insertBefore(last, first);

		expect(parent.childNodes).toHaveLength(3);
		expect(parent.firstChild).toBe(last);
		expect(last.nextSibling).toBe(first);
		expect(first.nextSibling).toBe(middle);
		expect(middle.nextSibling).toBeNull();
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		parent.insertBefore(last, middle);

		expect(parent.childNodes).toHaveLength(3);
		expect(parent.firstChild).toBe(first);
		expect(first.nextSibling).toBe(last);
		expect(last.nextSibling).toBe(middle);
		expect(middle.nextSibling).toBeNull();
		expect(notify).toHaveBeenCalled();

		parent.insertBefore(last, null);
		parent.insertBefore(first, first);

		expect(parent.childNodes).toHaveLength(3);
		expect(parent.childNodes[0]).toBe(first);
		expect(parent.childNodes[1]).toBe(middle);
		expect(parent.childNodes[2]).toBe(last);
		expect(parent.firstChild).toBe(first);
		expect(first.nextSibling).toBe(middle);
		expect(middle.nextSibling).toBe(last);
		expect(last.nextSibling).toBeNull();
		expect(first.parentNode).toBe(parent);
		expect(middle.parentNode).toBe(parent);
		expect(last.parentNode).toBe(parent);
	});

	it('connects and disconnects a subtree when inserting it into another parent', () => {
		const notify = vi.fn();
		const document = documentWithRoot(notify);
		const detached = document.createElement('div');
		const root = document.root;
		const branch = document.createElement('span');
		const text = document.createTextNode('before');
		const anchor = document.createTextNode('anchor');
		branch.appendChild(text);
		detached.appendChild(branch);
		root.appendChild(anchor);
		notify.mockClear();

		root.insertBefore(branch, anchor);

		expect(detached.childNodes).toHaveLength(0);
		expect(detached.firstChild).toBeNull();
		expect(root.childNodes).toHaveLength(2);
		expect(root.firstChild).toBe(branch);
		expect(branch.nextSibling).toBe(anchor);
		expect(branch.parentNode).toBe(root);
		expect(branch.childNodes[0]).toBe(text);
		expect(text.parentNode).toBe(branch);
		expect(branch.isConnected).toBe(true);
		expect(text.isConnected).toBe(true);
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		text.data = 'connected';
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		detached.insertBefore(branch, null);

		expect(root.childNodes).toHaveLength(1);
		expect(root.firstChild).toBe(anchor);
		expect(detached.childNodes).toHaveLength(1);
		expect(detached.firstChild).toBe(branch);
		expect(branch.parentNode).toBe(detached);
		expect(branch.nextSibling).toBeNull();
		expect(branch.childNodes[0]).toBe(text);
		expect(text.parentNode).toBe(branch);
		expect(branch.isConnected).toBe(false);
		expect(text.isConnected).toBe(false);
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		text.data = 'detached';
		expect(notify).not.toHaveBeenCalled();
	});

	it('rejects invalid insertion anchors and cycles before detaching any nodes', () => {
		const notify = vi.fn();
		const document = documentWithRoot(notify);
		const root = document.root;
		const parent = document.createElement('div');
		const other = document.createElement('div');
		const child = document.createElement('span');
		parent.appendChild(child);
		root.appendChild(parent);
		root.appendChild(other);
		notify.mockClear();

		expect(parent.insertBefore).toBeTypeOf('function');
		expect(() => other.insertBefore(child, parent)).toThrow();
		expect(parent.childNodes).toHaveLength(1);
		expect(parent.childNodes[0]).toBe(child);
		expect(child.parentNode).toBe(parent);
		expect(other.childNodes).toHaveLength(0);
		expect(notify).not.toHaveBeenCalled();

		expect(() => child.insertBefore(parent, null)).toThrow();
		expect(root.childNodes).toHaveLength(2);
		expect(root.childNodes[0]).toBe(parent);
		expect(root.childNodes[1]).toBe(other);
		expect(parent.parentNode).toBe(root);
		expect(parent.childNodes[0]).toBe(child);
		expect(child.parentNode).toBe(parent);
		expect(child.childNodes).toHaveLength(0);
		expect(notify).not.toHaveBeenCalled();

		expect(() => parent.insertBefore(parent, child)).toThrow();
		expect(root.childNodes[0]).toBe(parent);
		expect(parent.parentNode).toBe(root);
		expect(parent.childNodes).toHaveLength(1);
		expect(parent.childNodes[0]).toBe(child);
		expect(child.parentNode).toBe(parent);
		expect(notify).not.toHaveBeenCalled();
	});
});

describe('remove', () => {
	it('removes elements and text, updates sibling links, and ignores repeated removal', () => {
		const notify = vi.fn();
		const document = documentWithRoot(notify);
		const root = document.root;
		const branch = document.createElement('span');
		const nested = document.createTextNode('nested');
		const sibling = document.createTextNode('sibling');
		branch.appendChild(nested);
		root.appendChild(branch);
		root.appendChild(sibling);
		notify.mockClear();

		branch.remove();

		expect(root.childNodes).toHaveLength(1);
		expect(root.firstChild).toBe(sibling);
		expect(branch.parentNode).toBeNull();
		expect(branch.nextSibling).toBeNull();
		expect(branch.firstChild).toBe(nested);
		expect(nested.parentNode).toBe(branch);
		expect(branch.isConnected).toBe(false);
		expect(nested.isConnected).toBe(false);
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		branch.remove();
		expect(notify).not.toHaveBeenCalled();

		sibling.remove();

		expect(root.childNodes).toHaveLength(0);
		expect(root.firstChild).toBeNull();
		expect(sibling.parentNode).toBeNull();
		expect(sibling.nextSibling).toBeNull();
		expect(sibling.isConnected).toBe(false);
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		sibling.remove();
		expect(notify).not.toHaveBeenCalled();
	});
});

describe('setAttribute / removeAttribute', () => {
	it('stores string attributes for existing-node matching and updates them without duplicates', () => {
		const notify = vi.fn();
		const document = documentWithRoot(notify);
		const element = document.createElement('span');

		expect(element.attributes).toHaveLength(0);
		element.setAttribute('title', 'before');
		// Attribute values arrive from JavaScript as numbers and booleans too.
		Reflect.apply(element.setAttribute, element, ['data-count', 42]);
		Reflect.apply(element.setAttribute, element, ['aria-hidden', false]);

		expect(element.attributes).toHaveLength(3);
		expect(element.attributes[0]).toMatchObject({ name: 'title', value: 'before' });
		expect(element.attributes[1]).toMatchObject({ name: 'data-count', value: '42' });
		expect(element.attributes[2]).toMatchObject({ name: 'aria-hidden', value: 'false' });
		expect(notify).not.toHaveBeenCalled();

		document.root.appendChild(element);
		notify.mockClear();
		element.setAttribute('title', 'after');

		expect(element.attributes).toHaveLength(3);
		expect(element.attributes[0]).toMatchObject({ name: 'title', value: 'after' });
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		element.removeAttribute('data-count');

		expect(element.attributes).toHaveLength(2);
		expect(element.attributes[0]).toMatchObject({ name: 'title', value: 'after' });
		expect(element.attributes[1]).toMatchObject({ name: 'aria-hidden', value: 'false' });
		expect(notify).toHaveBeenCalled();

		notify.mockClear();
		element.removeAttribute('data-count');
		expect(element.attributes).toHaveLength(2);
		expect(notify).not.toHaveBeenCalled();

		document.root.removeChild(element);
		notify.mockClear();
		element.removeAttribute('title');
		element.removeAttribute('aria-hidden');
		expect(element.attributes).toHaveLength(0);
		expect(notify).not.toHaveBeenCalled();
	});
});

describe('events', () => {
	describe('Event', () => {
		it('starts with no dispatch state and allows framework bookkeeping', () => {
			expect(Event).toBeTypeOf('function');
			const event = new Event('click');

			expect(event.type).toBe('click');
			expect(event.bubbles).toBe(false);
			expect(event.cancelable).toBe(false);
			expect(event.defaultPrevented).toBe(false);
			expect(event.target).toBeNull();
			expect(event.currentTarget).toBeNull();
			expect(event.eventPhase).toBe(Event.NONE);
			expect(Event.NONE).toBe(0);
			expect(Event.CAPTURING_PHASE).toBe(1);
			expect(Event.AT_TARGET).toBe(2);
			expect(Event.BUBBLING_PHASE).toBe(3);

			const dispatched = Symbol('dispatched');
			expect(Reflect.set(event, dispatched, 1)).toBe(true);
			expect(Reflect.get(event, dispatched)).toBe(1);
		});
	});

	describe('addEventListener / removeEventListener', () => {
		it('calls a stable listener with the element as this as its handler changes', () => {
			const document = documentWithRoot(vi.fn());
			const first = vi.fn();
			const second = vi.fn();
			const element = Object.assign(document.createElement('span'), { handler: first });
			const listener = vi.fn(function (this: typeof element, event: Event): void {
				this.handler(event);
			});
			element.addEventListener('click', listener, false);
			element.addEventListener('click', listener, false);
			const initial = new Event('click');
			element.dispatchEvent(initial);

			expect(listener).toHaveBeenCalledTimes(1);
			expect(listener.mock.contexts[0]).toBe(element);
			expect(first).toHaveBeenCalledExactlyOnceWith(initial);

			element.handler = second;
			const updated = new Event('click');
			element.dispatchEvent(updated);

			expect(first).toHaveBeenCalledTimes(1);
			expect(second).toHaveBeenCalledExactlyOnceWith(updated);

			element.removeEventListener('click', listener, false);
			element.dispatchEvent(new Event('click'));

			expect(listener).toHaveBeenCalledTimes(2);
			expect(second).toHaveBeenCalledTimes(1);
		});

		it('keeps capture and non-capture registrations separate when removing listeners', () => {
			const document = documentWithRoot(vi.fn());
			const element = document.createElement('span');
			const listener = vi.fn();
			element.addEventListener('click', listener, true);
			element.addEventListener('click', listener, false);
			element.dispatchEvent(new Event('click'));
			expect(listener).toHaveBeenCalledTimes(2);

			listener.mockClear();
			element.removeEventListener('click', listener, true);
			element.dispatchEvent(new Event('click'));
			expect(listener).toHaveBeenCalledTimes(1);

			listener.mockClear();
			element.removeEventListener('click', listener, false);
			element.dispatchEvent(new Event('click'));
			expect(listener).not.toHaveBeenCalled();
		});

		it('scopes listeners by node and event type without requesting a render', () => {
			const notify = vi.fn();
			const document = documentWithRoot(notify);
			const first = document.createElement('span');
			const second = document.createElement('span');
			document.root.appendChild(first);
			document.root.appendChild(second);
			notify.mockClear();
			const listener = vi.fn();
			first.addEventListener('click', listener);
			first.addEventListener('keydown', listener);
			second.addEventListener('click', listener);

			first.removeEventListener('click', listener);
			first.removeEventListener('click', listener);
			first.removeEventListener('missing', listener);
			first.dispatchEvent(new Event('click'));
			expect(listener).not.toHaveBeenCalled();

			const keydown = new Event('keydown');
			first.dispatchEvent(keydown);
			expect(listener).toHaveBeenCalledExactlyOnceWith(keydown);

			listener.mockClear();
			const click = new Event('click');
			second.dispatchEvent(click);
			expect(listener).toHaveBeenCalledExactlyOnceWith(click);
			expect(notify).not.toHaveBeenCalled();
		});
	});

	describe('dispatchEvent', () => {
		it('sets the target and clears transient state even when there are no listeners', () => {
			const document = documentWithRoot(vi.fn());
			const target = document.createElement('span');
			const event = new Event('click', { bubbles: true, cancelable: true });

			expect(target.dispatchEvent(event)).toBe(true);

			expect(event.bubbles).toBe(true);
			expect(event.cancelable).toBe(true);
			expect(event.target).toBe(target);
			expect(event.currentTarget).toBeNull();
			expect(event.eventPhase).toBe(Event.NONE);
			expect(event.defaultPrevented).toBe(false);
		});

		it('captures through the document, invokes the target, and bubbles back in order', () => {
			const document = documentWithRoot(vi.fn());
			const root = document.root;
			const parent = document.createElement('div');
			const target = document.createElement('span');
			root.appendChild(parent);
			parent.appendChild(target);
			const event = new Event('click', { bubbles: true });
			const calls: string[] = [];
			const phases: number[] = [];
			const contexts: boolean[] = [];
			const targets: boolean[] = [];
			const events: boolean[] = [];
			function record(label: string, currentTarget: Node): (this: Node, received: Event) => void {
				return function (this: Node, received: Event): void {
					calls.push(label);
					phases.push(received.eventPhase);
					contexts.push(this === currentTarget && received.currentTarget === currentTarget);
					targets.push(received.target === target);
					events.push(received === event);
				};
			}
			document.addEventListener('click', record('document capture', document), true);
			root.addEventListener('click', record('root capture', root), true);
			parent.addEventListener('click', record('parent capture', parent), true);
			// Register non-capture first to verify that phase order takes precedence.
			target.addEventListener('click', record('target first', target));
			target.addEventListener('click', record('target capture', target), true);
			target.addEventListener('click', record('target second', target));
			parent.addEventListener('click', record('parent bubble', parent));
			root.addEventListener('click', record('root bubble', root));
			document.addEventListener('click', record('document bubble', document));

			expect(target.dispatchEvent(event)).toBe(true);

			expect(calls).toEqual([
				'document capture',
				'root capture',
				'parent capture',
				'target capture',
				'target first',
				'target second',
				'parent bubble',
				'root bubble',
				'document bubble',
			]);
			expect(phases).toEqual([
				Event.CAPTURING_PHASE,
				Event.CAPTURING_PHASE,
				Event.CAPTURING_PHASE,
				Event.AT_TARGET,
				Event.AT_TARGET,
				Event.AT_TARGET,
				Event.BUBBLING_PHASE,
				Event.BUBBLING_PHASE,
				Event.BUBBLING_PHASE,
			]);
			expect(contexts.every(Boolean)).toBe(true);
			expect(targets.every(Boolean)).toBe(true);
			expect(events.every(Boolean)).toBe(true);
			expect(event.target).toBe(target);
			expect(event.currentTarget).toBeNull();
			expect(event.eventPhase).toBe(Event.NONE);
		});

		it('captures non-bubbling events and invokes both groups of target listeners', () => {
			const document = documentWithRoot(vi.fn());
			const root = document.root;
			const target = document.createElement('span');
			root.appendChild(target);
			const calls: string[] = [];
			root.addEventListener('click', () => calls.push('root capture'), true);
			root.addEventListener('click', () => calls.push('root bubble'));
			target.addEventListener('click', () => calls.push('target'));
			target.addEventListener('click', () => calls.push('target capture'), true);

			target.dispatchEvent(new Event('click'));

			expect(calls).toEqual(['root capture', 'target capture', 'target']);
		});

		it('preserves listeners and dispatches within a detached subtree without rendering', () => {
			const notify = vi.fn();
			const document = documentWithRoot(notify);
			const parent = document.createElement('div');
			const target = document.createElement('span');
			parent.appendChild(target);
			document.root.appendChild(parent);
			const calls: string[] = [];
			document.addEventListener('click', () => calls.push('document'));
			parent.addEventListener('click', () => calls.push('parent capture'), true);
			parent.addEventListener('click', () => calls.push('parent bubble'));
			target.addEventListener('click', () => calls.push('target'));
			parent.remove();
			notify.mockClear();

			target.dispatchEvent(new Event('click', { bubbles: true }));

			expect(target.isConnected).toBe(false);
			expect(calls).toEqual(['parent capture', 'target', 'parent bubble']);
			expect(notify).not.toHaveBeenCalled();
		});

		it('keeps the original ancestor path when a listener reparents the target', () => {
			const document = documentWithRoot(vi.fn());
			const root = document.root;
			const original = document.createElement('div');
			const destination = document.createElement('div');
			const target = document.createElement('span');
			root.appendChild(original);
			root.appendChild(destination);
			original.appendChild(target);
			const calls: string[] = [];
			original.addEventListener(
				'click',
				() => {
					calls.push('original capture');
					destination.appendChild(target);
				},
				true,
			);
			original.addEventListener('click', () => calls.push('original bubble'));
			destination.addEventListener('click', () => calls.push('destination capture'), true);
			destination.addEventListener('click', () => calls.push('destination bubble'));
			target.addEventListener('click', () => calls.push('target'));
			root.addEventListener('click', () => calls.push('root bubble'));

			target.dispatchEvent(new Event('click', { bubbles: true }));

			expect(target.parentNode).toBe(destination);
			expect(calls).toEqual(['original capture', 'target', 'original bubble', 'root bubble']);

			calls.length = 0;
			target.dispatchEvent(new Event('click', { bubbles: true }));
			expect(calls).toEqual(['destination capture', 'target', 'destination bubble', 'root bubble']);
		});

		it('skips a removed listener even if the same callback is registered again', () => {
			const document = documentWithRoot(vi.fn());
			const target = document.createElement('span');
			const calls: string[] = [];
			const later = (): number => calls.push('later');
			const replace = (): void => {
				calls.push('replace');
				target.removeEventListener('click', later);
				target.addEventListener('click', later);
			};
			target.addEventListener('click', replace);
			target.addEventListener('click', later);

			target.dispatchEvent(new Event('click'));
			expect(calls).toEqual(['replace']);

			target.removeEventListener('click', replace);
			calls.length = 0;
			target.dispatchEvent(new Event('click'));
			expect(calls).toEqual(['later']);
		});

		it('allows additions in a later phase but defers additions to the current listener list', () => {
			const document = documentWithRoot(vi.fn());
			const target = document.createElement('span');
			const calls: string[] = [];
			const later = (): number => calls.push('later');
			const added = (): void => {
				calls.push('added');
				target.addEventListener('click', later);
			};
			target.addEventListener(
				'click',
				() => {
					calls.push('capture');
					target.addEventListener('click', added);
				},
				true,
			);

			target.dispatchEvent(new Event('click'));
			expect(calls).toEqual(['capture', 'added']);

			calls.length = 0;
			target.dispatchEvent(new Event('click'));
			expect(calls).toEqual(['capture', 'added', 'later']);
		});

		it('supports nested events, rejects active-event redispatch, and permits later reuse', () => {
			const document = documentWithRoot(vi.fn());
			const target = document.createElement('span');
			const outer = new Event('outer');
			const inner = new Event('inner');
			const calls: string[] = [];
			const states: boolean[] = [];
			let redispatchError: unknown;
			let redispatching = false;
			target.addEventListener('inner', (event: Event) => {
				calls.push('inner');
				states.push(event.currentTarget === target && outer.currentTarget === target);
			});
			target.addEventListener('outer', (event: Event) => {
				if (redispatching) {
					calls.push('unexpected redispatch');
					return;
				}
				calls.push('outer start');
				redispatching = true;
				try {
					target.dispatchEvent(event);
				} catch (error) {
					redispatchError = error;
				} finally {
					redispatching = false;
				}
				target.dispatchEvent(inner);
				states.push(event.currentTarget === target && event.eventPhase === Event.AT_TARGET);
				states.push(inner.currentTarget === null && inner.eventPhase === Event.NONE);
				calls.push('outer end');
			});

			target.dispatchEvent(outer);

			expect(redispatchError).toBeInstanceOf(Error);
			expect(calls).toEqual(['outer start', 'inner', 'outer end']);
			expect(states).toEqual([true, true, true]);
			expect(outer.currentTarget).toBeNull();
			expect(outer.eventPhase).toBe(Event.NONE);

			calls.length = 0;
			states.length = 0;
			redispatchError = undefined;
			target.dispatchEvent(outer);
			expect(redispatchError).toBeInstanceOf(Error);
			expect(calls).toEqual(['outer start', 'inner', 'outer end']);
			expect(states).toEqual([true, true, true]);
		});
	});

	describe('stopPropagation', () => {
		it('finishes the current ancestor capture listeners without reaching the target', () => {
			const document = documentWithRoot(vi.fn());
			const root = document.root;
			const target = document.createElement('span');
			root.appendChild(target);
			const calls: string[] = [];
			root.addEventListener(
				'click',
				(event: Event) => {
					calls.push('first capture');
					event.stopPropagation();
				},
				true,
			);
			root.addEventListener('click', () => calls.push('second capture'), true);
			root.addEventListener('click', () => calls.push('root bubble'));
			target.addEventListener('click', () => calls.push('target capture'), true);
			target.addEventListener('click', () => calls.push('target'));

			target.dispatchEvent(new Event('click', { bubbles: true }));

			expect(calls).toEqual(['first capture', 'second capture']);
		});

		it('stops capture before visiting another ancestor', () => {
			const document = documentWithRoot(vi.fn());
			const root = document.root;
			const parent = document.createElement('div');
			const target = document.createElement('span');
			root.appendChild(parent);
			parent.appendChild(target);
			const calls: string[] = [];
			root.addEventListener(
				'click',
				(event: Event) => {
					calls.push('first root capture');
					event.stopPropagation();
				},
				true,
			);
			root.addEventListener('click', () => calls.push('second root capture'), true);
			parent.addEventListener('click', () => calls.push('parent capture'), true);
			target.addEventListener('click', () => calls.push('target capture'), true);
			target.addEventListener('click', () => calls.push('target'));
			parent.addEventListener('click', () => calls.push('parent bubble'));
			root.addEventListener('click', () => calls.push('root bubble'));
			document.addEventListener('click', () => calls.push('document bubble'));
			const event = new Event('click', { bubbles: true, cancelable: true });

			expect(target.dispatchEvent(event)).toBe(true);

			expect(calls).toEqual(['first root capture', 'second root capture']);
			expect(event.defaultPrevented).toBe(false);
			expect(event.currentTarget).toBeNull();
			expect(event.eventPhase).toBe(Event.NONE);
		});

		it('finishes target capture listeners without entering the non-capture phase', () => {
			const document = documentWithRoot(vi.fn());
			const root = document.root;
			const target = document.createElement('span');
			root.appendChild(target);
			const calls: string[] = [];
			target.addEventListener(
				'click',
				(event: Event) => {
					calls.push('first capture');
					event.stopPropagation();
				},
				true,
			);
			target.addEventListener('click', () => calls.push('second capture'), true);
			target.addEventListener('click', () => calls.push('target'));
			root.addEventListener('click', () => calls.push('root bubble'));

			target.dispatchEvent(new Event('click', { bubbles: true }));

			expect(calls).toEqual(['first capture', 'second capture']);
		});

		it('finishes target listeners without bubbling or canceling the event', () => {
			const document = documentWithRoot(vi.fn());
			const root = document.root;
			const target = document.createElement('span');
			root.appendChild(target);
			const calls: string[] = [];
			target.addEventListener('click', (event: Event) => {
				calls.push('first');
				event.stopPropagation();
			});
			target.addEventListener('click', () => calls.push('second'));
			root.addEventListener('click', () => calls.push('root bubble'));
			const event = new Event('click', { bubbles: true, cancelable: true });

			expect(target.dispatchEvent(event)).toBe(true);

			expect(calls).toEqual(['first', 'second']);
			expect(event.defaultPrevented).toBe(false);
		});

		it('finishes the current ancestor bubble listeners without visiting further ancestors', () => {
			const document = documentWithRoot(vi.fn());
			const root = document.root;
			const parent = document.createElement('div');
			const target = document.createElement('span');
			root.appendChild(parent);
			parent.appendChild(target);
			const calls: string[] = [];
			target.addEventListener('click', () => calls.push('target'));
			parent.addEventListener('click', (event: Event) => {
				calls.push('first parent bubble');
				event.stopPropagation();
			});
			parent.addEventListener('click', () => calls.push('second parent bubble'));
			root.addEventListener('click', () => calls.push('root bubble'));
			document.addEventListener('click', () => calls.push('document bubble'));
			const event = new Event('click', { bubbles: true, cancelable: true });

			expect(target.dispatchEvent(event)).toBe(true);

			expect(calls).toEqual(['target', 'first parent bubble', 'second parent bubble']);
			expect(event.defaultPrevented).toBe(false);
			expect(event.currentTarget).toBeNull();
			expect(event.eventPhase).toBe(Event.NONE);
		});
	});

	describe('stopImmediatePropagation', () => {
		it('stops remaining ancestor bubble listeners and further ancestors', () => {
			const document = documentWithRoot(vi.fn());
			const root = document.root;
			const parent = document.createElement('div');
			const target = document.createElement('span');
			root.appendChild(parent);
			parent.appendChild(target);
			const calls: string[] = [];
			target.addEventListener('click', () => calls.push('target'));
			parent.addEventListener('click', (event: Event) => {
				calls.push('first parent bubble');
				event.stopImmediatePropagation();
			});
			parent.addEventListener('click', () => calls.push('second parent bubble'));
			root.addEventListener('click', () => calls.push('root bubble'));
			document.addEventListener('click', () => calls.push('document bubble'));
			const event = new Event('click', { bubbles: true, cancelable: true });

			expect(target.dispatchEvent(event)).toBe(true);

			expect(calls).toEqual(['target', 'first parent bubble']);
			expect(event.defaultPrevented).toBe(false);
			expect(event.currentTarget).toBeNull();
			expect(event.eventPhase).toBe(Event.NONE);
		});

		it('stops remaining listeners and ancestors, then clears the stop flags for reuse', () => {
			const document = documentWithRoot(vi.fn());
			const root = document.root;
			const target = document.createElement('span');
			root.appendChild(target);
			const calls: string[] = [];
			const stop = (event: Event): void => {
				calls.push('stop');
				event.stopImmediatePropagation();
			};
			target.addEventListener('click', stop);
			target.addEventListener('click', () => calls.push('target'));
			root.addEventListener('click', () => calls.push('root bubble'));
			const event = new Event('click', { bubbles: true, cancelable: true });

			expect(target.dispatchEvent(event)).toBe(true);
			expect(calls).toEqual(['stop']);
			expect(event.defaultPrevented).toBe(false);
			expect(event.currentTarget).toBeNull();
			expect(event.eventPhase).toBe(Event.NONE);

			target.removeEventListener('click', stop);
			calls.length = 0;
			expect(target.dispatchEvent(event)).toBe(true);
			expect(calls).toEqual(['target', 'root bubble']);
		});
	});

	describe('preventDefault', () => {
		it('cancels only cancelable events without stopping propagation', () => {
			const document = documentWithRoot(vi.fn());
			const root = document.root;
			const target = document.createElement('span');
			root.appendChild(target);
			const prevented: boolean[] = [];
			const prevent = (event: Event): void => event.preventDefault();
			target.addEventListener('click', prevent);
			root.addEventListener('click', (event: Event) => prevented.push(event.defaultPrevented));
			const ordinary = new Event('click', { bubbles: true });
			const cancelable = new Event('click', { bubbles: true, cancelable: true });

			expect(target.dispatchEvent(ordinary)).toBe(true);
			expect(ordinary.defaultPrevented).toBe(false);
			expect(target.dispatchEvent(cancelable)).toBe(false);
			expect(cancelable.defaultPrevented).toBe(true);
			expect(prevented).toEqual([false, true]);

			target.removeEventListener('click', prevent);
			expect(target.dispatchEvent(cancelable)).toBe(false);
			expect(cancelable.defaultPrevented).toBe(true);
		});
	});
});

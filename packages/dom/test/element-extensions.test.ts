import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { Document, Element, HTMLSlotElement } from '../src/dom.ts';
import { installParsing } from '../src/parsing.ts';
import { enqueueUpgrade } from '../src/custom-elements.ts';
import { MutationObserver } from '../src/observation.ts';

class BoxElement extends Element {
	constructor(document: Document) {
		super('box', document);
	}
	value = 'ready';
}
declare module '../src/dom.ts' {
	interface Elements {
		box: BoxElement;
	}
}

describe('document-local element extensions and token lists', () => {
	it('constructs typed terminal elements without affecting other documents or namespaces', () => {
		const document = new Document();
		const other = new Document();
		document.registerElement('box', (owner) => new BoxElement(owner));
		const box = document.createElement('box');
		expect(box.value).toBe('ready');
		expect(box.ownerDocument).toBe(document);
		expect(other.createElement('box')).not.toBeInstanceOf(BoxElement);
		expect(document.createElementNS('http://www.w3.org/2000/svg', 'box')).not.toBeInstanceOf(
			BoxElement,
		);
		expect(box.cloneNode()).toBeInstanceOf(BoxElement);
		installParsing(document);
		const container = document.createElement('div');
		container.innerHTML = '<box>hello</box>';
		expect(container.firstChild).toBeInstanceOf(BoxElement);
		expect(() => document.registerElement('box', (owner) => new BoxElement(owner))).toThrow();
		expect(() => document.registerElement('input', (owner) => new BoxElement(owner))).toThrow();
		expect(() => document.registerElement('x-box', (owner) => new BoxElement(owner))).toThrow();
	});
	it('rejects incompatible factories and preserves arbitrary names from Object.prototype', () => {
		const document = new Document();
		document.registerElement('bad', () => new Element('bad', new Document()));
		expect(() => document.createElement('bad')).toThrow();
		for (const name of ['constructor', '__proto__', 'toString']) {
			const element = document.createElement(name);
			expect(element).toBeInstanceOf(Element);
			expect(element.localName).toBe(name.toLowerCase());
		}
	});
	it('keeps token lists live and ordered, validating every token before mutation', () => {
		const element = new Document().createElement('div');
		const tokens = element.classList;
		expect(element.classList).toBe(tokens);
		element.setAttribute('class', 'a a\tb c');
		expect([...tokens]).toEqual(['a', 'b', 'c']);
		expect(tokens.replace('a', 'c')).toBe(true);
		expect(tokens.value).toBe('c b');
		expect(() => tokens.add('valid', 'two words')).toThrow();
		expect(tokens.value).toBe('c b');
		expect(() => tokens.remove('c', '')).toThrow();
		expect(tokens.value).toBe('c b');
		expect(tokens.toggle('c', false)).toBe(false);
		expect(tokens.toggle('d')).toBe(true);
		expect(tokens.item(2)).toBeNull();
		expect([...tokens.entries()]).toEqual([
			[0, 'b'],
			[1, 'd'],
		]);
		expect(() => tokens.supports('b')).toThrow(TypeError);
	});
});

describe('manual slots and declarative shadow roots', () => {
	it('invalidates connected manual distribution without recording a tree mutation', () => {
		const invalidated = vi.fn();
		const document = new Document({ onInvalidate: invalidated });
		const host = document.createElement('div');
		const shadow = host.attachShadow({ mode: 'open', slotAssignment: 'manual' });
		const slot = shadow.appendChild(document.createElement('slot'));
		const child = host.appendChild(document.createElement('span'));
		slot.assign(child);
		expect(invalidated).not.toHaveBeenCalled();
		document.append(host);
		const observer = new MutationObserver(() => {});
		observer.observe(slot, { childList: true, subtree: true, attributes: true });
		invalidated.mockClear();
		slot.assign();
		expect(invalidated).toHaveBeenCalledOnce();
		expect(observer.takeRecords()).toEqual([]);
		invalidated.mockClear();
		slot.assign();
		expect(invalidated).not.toHaveBeenCalled();
	});
	it('distributes manually in assignment order, transfers slots, and retains assignments on reconnect', async () => {
		const document = new Document();
		const host = document.appendChild(document.createElement('div'));
		const root = host.attachShadow({ mode: 'open', slotAssignment: 'manual' });
		const first = document.createElement('slot');
		const second = document.createElement('slot');
		root.append(first, second);
		const a = document.createElement('span');
		const b = document.createTextNode('b');
		host.append(a, b);
		expect(first.assignedNodes()).toEqual([]);
		const changed = vi.fn();
		first.addEventListener('slotchange', changed);
		first.assign(b, a, b);
		expect(first.assignedNodes()).toEqual([b, a]);
		expect(first.assignedElements()).toEqual([a]);
		expect(a.assignedSlot).toBe(first);
		second.assign(a);
		expect(first.assignedNodes()).toEqual([b]);
		expect(second.assignedNodes()).toEqual([a]);
		await Promise.resolve();
		expect(changed).toHaveBeenCalledOnce();
		a.remove();
		expect(second.assignedNodes()).toEqual([]);
		host.append(a);
		expect(second.assignedNodes()).toEqual([a]);
		second.assign();
		expect(a.assignedSlot).toBeNull();
	});
	it('does not change named distribution through assign and prevalidates invalid slottables', () => {
		const document = new Document();
		const host = document.createElement('div');
		const shadow = host.attachShadow({ mode: 'open' });
		const slot = shadow.appendChild(document.createElement('slot'));
		const child = host.appendChild(document.createElement('span'));
		slot.assign();
		expect(slot.assignedNodes()).toEqual([child]);
		expect(() => Reflect.apply(slot.assign, slot, [child, document.createComment('bad')])).toThrow(
			TypeError,
		);
		expect(slot.assignedNodes()).toEqual([child]);
	});
	it('parses declarative roots only through explicit parsing and preserves hydration identity', () => {
		const document = new Document();
		installParsing(document);
		const outer = document.createElement('div');
		const markup =
			'<section><template shadowrootmode="open" shadowrootclonable shadowrootserializable><span>shadow</span></template>light</section>';
		outer.innerHTML = markup;
		expect(outer.firstElementChild?.shadowRoot).toBeNull();
		outer.setHTMLUnsafe(markup);
		const host = outer.firstElementChild;
		assert(host);
		const shadow = host.shadowRoot;
		assert(shadow);
		expect(shadow.textContent).toBe('shadow');
		expect(host.textContent).toBe('light');
		expect(shadow.clonable).toBe(true);
		expect(shadow.serializable).toBe(true);
		expect(outer.innerHTML).toBe('<section>light</section>');
		expect(outer.getHTML({ serializableShadowRoots: true })).toContain(
			'<template shadowrootmode="open"',
		);
		expect(() => host.attachShadow({ mode: 'closed' })).toThrow();
		expect(host.shadowRoot).toBe(shadow);
		expect(host.attachShadow({ mode: 'open' })).toBe(shadow);
		expect(shadow.childNodes).toHaveLength(0);
		expect(() => host.attachShadow({ mode: 'open' })).toThrow();
	});
	it('keeps a top-level shadow template inert when parsing a fragment into an existing host', () => {
		const document = new Document();
		installParsing(document);
		const host = document.createElement('div');
		host.setHTMLUnsafe('<template shadowrootmode="open">shadow</template>light');
		expect(host.shadowRoot).toBeNull();
		expect(host.firstElementChild?.localName).toBe('template');
	});
	it('copies clonable shadow descendants even on shallow host clones and adopts their owners', () => {
		const document = new Document();
		const host = document.createElement('div');
		const shadow = host.attachShadow({
			mode: 'open',
			clonable: true,
			serializable: true,
			delegatesFocus: true,
		});
		shadow.append(document.createElement('input'));
		host.append('light');
		const copy = host.cloneNode();
		assert(copy instanceof Element);
		expect(copy.childNodes).toHaveLength(0);
		expect(copy.shadowRoot?.firstChild).not.toBe(shadow.firstChild);
		expect(copy.shadowRoot?.firstChild?.nodeName).toBe('INPUT');
		expect(copy.shadowRoot?.delegatesFocus).toBe(true);
		const other = new Document();
		const imported = other.importNode(host, true);
		assert(imported instanceof Element);
		expect(imported.shadowRoot?.firstChild?.ownerDocument).toBe(other);
		expect(imported.textContent).toBe('light');
	});
	it('upgrades nested declarative content after parsing and supports closed-root serialization', () => {
		const document = new Document();
		installParsing(document);
		const host = document.appendChild(document.createElement('div'));
		const calls: string[] = [];
		class Item extends document.HTMLElement {
			constructor() {
				super();
				calls.push(`${this.id}:${this.textContent}:${this.isConnected}`);
			}
		}
		document.customElements.define('x-item', Item);
		host.setHTMLUnsafe(
			'<section><template shadowrootmode="open" shadowrootslotassignment="manual"><x-item id="inner">value</x-item><slot></slot></template>light</section>',
		);
		expect(calls).toEqual(['inner:value:true']);
		expect(host.firstElementChild?.shadowRoot?.slotAssignment).toBe('manual');
		expect(host.firstElementChild?.shadowRoot?.lastChild).toBeInstanceOf(HTMLSlotElement);
		const hidden = document.createElement('section');
		const closed = hidden.attachShadow({ mode: 'closed' });
		closed.append('secret');
		expect(hidden.getHTML()).toBe('');
		expect(hidden.getHTML({ shadowRoots: [closed] })).toBe(
			'<template shadowrootmode="closed">secret</template>',
		);
	});
	it('upgrades custom clones after their attributes, light tree and shadow tree exist', () => {
		const document = new Document();
		const calls: string[] = [];
		class Item extends document.HTMLElement {
			constructor() {
				super();
				calls.push(`${this.id}:${this.textContent}:${this.shadowRoot?.textContent ?? 'none'}`);
				if (!this.shadowRoot) this.attachShadow({ mode: 'open', clonable: true }).append('shadow');
			}
		}
		document.customElements.define('x-cloned', Item);
		const original = new Item();
		original.id = 'original';
		original.append('light');
		calls.length = 0;
		const copy = original.cloneNode(true);
		expect(copy).toBeInstanceOf(Item);
		assert(copy instanceof Element);
		expect(calls).toEqual(['original:light:shadow']);
		expect(copy.shadowRoot?.firstChild).not.toBe(original.shadowRoot?.firstChild);
	});
});

describe('bounded custom-element reaction scopes', () => {
	it('drains direct parser reactions on failure without leaking work into another document', async () => {
		const document = new Document();
		installParsing(document);
		const calls: string[] = [];
		class Item extends document.HTMLElement {
			constructor() {
				super();
				calls.push('constructed');
			}
		}
		document.customElements.define('x-item', Item);
		document.registerElement('broken', () => {
			// oxlint-disable-next-line bombshell-dev/no-generic-error -- Deliberately fail a user factory to test reaction cleanup.
			throw new RangeError('factory failed');
		});
		expect(() =>
			document.markupParser.parse(
				document.createElement('div'),
				'<x-item></x-item><broken></broken>',
			),
		).toThrow('factory failed');
		expect(calls).toEqual(['constructed']);
		const other = new Document();
		other.append(other.createElement('div'));
		await Promise.resolve();
		expect(calls).toEqual(['constructed']);
	});
	it('keeps backup queues independent and automatically delivers them in a microtask', async () => {
		const first = new Document();
		const second = new Document();
		const item = first.createElement('x-item');
		const calls: string[] = [];
		class Item extends first.HTMLElement {
			constructor() {
				super();
				calls.push('constructed');
			}
		}
		first.customElements.define('x-item', Item);
		enqueueUpgrade(item);
		second.append(second.createElement('div'));
		expect(calls).toEqual([]);
		await Promise.resolve();
		expect(item).toBeInstanceOf(Item);
		expect(calls).toEqual(['constructed']);
	});
});

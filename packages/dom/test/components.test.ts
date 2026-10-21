import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { Document, Element, HTMLTemplateElement, HTMLSlotElement } from '../src/dom.ts';
import { Event } from '../src/events.ts';
import { installParsing } from '../src/parsing.ts';

function setup(): { document: Document; root: Element } {
	const document = new Document();
	const root = document.createElement('screen');
	document.appendChild(root);
	return { document, root };
}

describe('autonomous custom elements', () => {
	it('runs moving lifecycle callbacks after adoption and insertion finish', () => {
		const first = setup();
		const second = setup();
		const calls: string[] = [];
		class Item extends first.document.HTMLElement {
			connectedCallback(): void {
				calls.push('connected');
			}
			disconnectedCallback(): void {
				expect(this.parentNode).toBe(second.root);
				expect(this.ownerDocument).toBe(second.document);
				expect(this.isConnected).toBe(true);
				calls.push('disconnected');
			}
			adoptedCallback(): void {
				expect(this.parentNode).toBe(second.root);
				calls.push('adopted');
			}
		}
		first.document.customElements.define('x-item', Item);
		const item = first.root.appendChild(new Item());
		calls.length = 0;
		second.root.appendChild(item);
		expect(calls).toEqual(['disconnected', 'adopted', 'connected']);
	});
	it('finishes removing all children before a disconnected callback can reinsert a sibling', () => {
		const { document, root } = setup();
		const calls: string[] = [];
		class Item extends document.HTMLElement {
			disconnectedCallback(): void {
				calls.push(this.id);
				if (this.id === 'first') {
					expect(root.childNodes).toHaveLength(0);
					root.appendChild(second);
				}
			}
		}
		document.customElements.define('x-item', Item);
		const first = new Item();
		first.id = 'first';
		const second = new Item();
		second.id = 'second';
		root.append(first, second);
		root.replaceChildren();
		expect(calls).toEqual(['first', 'second']);
		expect(root.childNodes).toEqual([second]);
	});
	it('finishes inserting all before/after arguments before their connected callbacks', () => {
		const { document, root } = setup();
		const calls: string[] = [];
		class Item extends document.HTMLElement {
			connectedCallback(): void {
				calls.push(root.textContent ?? '');
			}
		}
		document.customElements.define('x-item', Item);
		const anchor = root.appendChild(document.createElement('anchor'));
		anchor.textContent = 'anchor';
		const before = new Item();
		before.textContent = 'before';
		anchor.before(before, ' one');
		const after = new Item();
		after.textContent = 'after';
		anchor.after(after, ' two');
		expect(calls).toEqual(['before oneanchor', 'before oneanchorafter two']);
	});
	it('clears reactions when an existing element cannot be upgraded', () => {
		const errors: unknown[] = [];
		const calls: string[] = [];
		const document = new Document({ reportError: (error) => errors.push(error) });
		const item = document.appendChild(document.createElement('x-item'));
		item.setAttribute('value', 'one');
		Object.preventExtensions(item);
		class Item extends document.HTMLElement {
			static override observedAttributes = ['value'];
			connectedCallback(): void {
				calls.push('connected');
			}
			attributeChangedCallback(): void {
				calls.push('attribute');
			}
		}
		document.customElements.define('x-item', Item);
		document.customElements.upgrade(item);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toBeInstanceOf(TypeError);
		expect(calls).toEqual([]);
	});
	it('captures lifecycle callbacks at definition time', () => {
		const { document, root } = setup();
		const calls: string[] = [];
		class Item extends document.HTMLElement {
			static override observedAttributes = ['value'];
			connectedCallback(): void {
				calls.push('original connected');
			}
			attributeChangedCallback(): void {
				calls.push('original attribute');
			}
		}
		document.customElements.define('x-item', Item);
		Item.prototype.connectedCallback = () => {
			calls.push('replacement connected');
		};
		Item.prototype.attributeChangedCallback = () => {
			calls.push('replacement attribute');
		};
		const item = new Item();
		root.appendChild(item);
		item.setAttribute('value', 'next');
		expect(calls).toEqual(['original connected', 'original attribute']);
	});
	it('only reads observedAttributes when an attribute callback was registered', () => {
		const { document } = setup();
		let reads = 0;
		class Item extends document.HTMLElement {
			static override get observedAttributes(): string[] {
				reads++;
				return ['value'];
			}
		}
		document.customElements.define('x-item', Item);
		expect(reads).toBe(0);
	});
	it('rejects non-callable lifecycle methods without registering a partial definition', () => {
		const { document } = setup();
		class Item extends document.HTMLElement {}
		Reflect.set(Item.prototype, 'connectedCallback', 42);
		expect(() => document.customElements.define('x-item', Item)).toThrow(TypeError);
		expect(document.customElements.get('x-item')).toBeUndefined();
		Reflect.deleteProperty(Item.prototype, 'connectedCallback');
		document.customElements.define('x-item', Item);
		expect(document.createElement('x-item')).toBeInstanceOf(Item);
	});
	it('rejects recursive definition getters and restores the registry after failure', () => {
		const { document } = setup();
		let recurse = true;
		class Other extends document.HTMLElement {}
		class Item extends document.HTMLElement {
			static override get observedAttributes(): string[] {
				if (recurse) document.customElements.define('x-other', Other);
				return ['value'];
			}
			attributeChangedCallback(): void {}
		}
		expect(() => document.customElements.define('x-item', Item)).toThrow(
			expect.objectContaining({ name: 'NotSupportedError' }),
		);
		expect(document.customElements.get('x-item')).toBeUndefined();
		expect(document.customElements.get('x-other')).toBeUndefined();
		recurse = false;
		document.customElements.define('x-item', Item);
		document.customElements.define('x-other', Other);
		expect(document.createElement('x-item')).toBeInstanceOf(Item);
	});
	it('snapshots pre-upgrade attribute values before a constructor changes attributes', () => {
		const { document, root } = setup();
		const calls: string[] = [];
		const existing = document.createElement('x-item');
		existing.setAttribute('value', 'before');
		root.appendChild(existing);
		class Item extends document.HTMLElement {
			static override observedAttributes = ['value'];
			constructor() {
				super();
				calls.push('construct start');
				this.setAttribute('value', 'after');
				calls.push('construct end');
			}
			attributeChangedCallback(_name: string, old: string | null, value: string): void {
				calls.push(`${old}:${value}`);
			}
			connectedCallback(): void {
				calls.push('connected');
			}
		}
		document.customElements.define('x-item', Item);
		expect(existing.getAttribute('value')).toBe('after');
		expect(calls).toEqual(['construct start', 'construct end', 'null:before', 'connected']);
	});
	it('finishes each upgrade and its callbacks before constructing the next candidate', () => {
		const { document, root } = setup();
		const calls: string[] = [];
		const first = document.createElement('x-item');
		first.id = 'first';
		const second = document.createElement('x-item');
		second.id = 'second';
		root.append(first, second);
		class Item extends document.HTMLElement {
			constructor() {
				super();
				calls.push(`${this.id}:construct`);
			}
			connectedCallback(): void {
				calls.push(`${this.id}:connected`);
			}
		}
		document.customElements.define('x-item', Item);
		expect(calls).toEqual([
			'first:construct',
			'first:connected',
			'second:construct',
			'second:connected',
		]);
	});
	it('delivers nested attribute callbacks before the modifying call returns', () => {
		const { document } = setup();
		const calls: string[] = [];
		class Item extends document.HTMLElement {
			static override observedAttributes = ['first', 'second'];
			attributeChangedCallback(name: string): void {
				calls.push(`${name}:start`);
				if (name === 'first') this.setAttribute('second', 'value');
				calls.push(`${name}:end`);
			}
		}
		document.customElements.define('x-item', Item);
		new Item().setAttribute('first', 'value');
		expect(calls).toEqual(['first:start', 'second:start', 'second:end', 'first:end']);
	});
	it('drains already queued reactions for an element before its reentrant new reaction', () => {
		const { document, root } = setup();
		const calls: string[] = [];
		const item = document.createElement('x-item');
		item.setAttribute('first', 'one');
		item.setAttribute('second', 'two');
		root.appendChild(item);
		class Item extends document.HTMLElement {
			static override observedAttributes = ['first', 'second'];
			attributeChangedCallback(name: string, _old: string | null, value: string): void {
				calls.push(`${name}:${value}`);
				if (name === 'first') {
					this.setAttribute('second', 'changed');
					calls.push('first:return');
				}
			}
			connectedCallback(): void {
				calls.push('connected');
			}
		}
		document.customElements.define('x-item', Item);
		expect(calls).toEqual([
			'first:one',
			'second:two',
			'connected',
			'second:changed',
			'first:return',
		]);
	});
	it('cancels uninvoked reactions after a failed upgrade and never retries that element', () => {
		const errors: unknown[] = [];
		const document = new Document({ reportError: (error) => errors.push(error) });
		const root = document.appendChild(document.createElement('root'));
		const item = root.appendChild(document.createElement('x-item'));
		item.setAttribute('value', 'before');
		const failure = new RangeError('constructor failed');
		const calls: string[] = [];
		class Item extends document.HTMLElement {
			static override observedAttributes = ['value'];
			constructor() {
				super();
				calls.push('construct');
				throw failure;
			}
			connectedCallback(): void {
				calls.push('connected');
			}
			attributeChangedCallback(): void {
				calls.push('attribute');
			}
		}
		document.customElements.define('x-item', Item);
		item.setAttribute('value', 'after');
		item.remove();
		root.appendChild(item);
		document.customElements.upgrade(item);
		expect(calls).toEqual(['construct']);
		expect(errors).toEqual([failure]);
	});
	it('keeps a shared pending whenDefined promise and document ownership across async upgrades', async () => {
		const first = setup();
		const second = setup();
		const calls: string[] = [];
		const waiting = first.document.customElements.whenDefined('x-item');
		expect(first.document.customElements.whenDefined('x-item')).toBe(waiting);
		const firstItem = first.root.appendChild(first.document.createElement('x-item'));
		const secondItem = second.root.appendChild(second.document.createElement('x-item'));
		class First extends first.document.HTMLElement {
			connectedCallback(): void {
				calls.push('first');
			}
		}
		class Second extends second.document.HTMLElement {
			connectedCallback(): void {
				calls.push('second');
			}
		}
		await Promise.resolve();
		first.document.customElements.define('x-item', First);
		first.document.customElements.upgrade(secondItem);
		expect(secondItem).not.toBeInstanceOf(First);
		await Promise.resolve();
		second.document.customElements.define('x-item', Second);
		expect(await waiting).toBe(First);
		expect(firstItem).toBeInstanceOf(First);
		expect(secondItem).toBeInstanceOf(Second);
		expect(firstItem.ownerDocument).toBe(first.document);
		expect(secondItem.ownerDocument).toBe(second.document);
		expect(calls).toEqual(['first', 'second']);
	});
	it('constructs registered classes without installing globals', () => {
		const { document, root } = setup();
		class Counter extends document.HTMLElement {
			count = 1;
		}
		document.customElements.define('x-counter', Counter);
		const counter = document.createElement('x-counter');
		expect(counter).toBeInstanceOf(Counter);
		expect(new Counter().ownerDocument).toBe(document);
		root.appendChild(counter);
		expect(document.customElements.getName(Counter)).toBe('x-counter');
		expect(globalThis).not.toHaveProperty('document');
	});
	it('upgrades existing identity, descendants, user state and listeners', () => {
		const { document, root } = setup();
		const existing = document.createElement('x-counter');
		const text = document.createTextNode('retained');
		existing.appendChild(text);
		const listener = vi.fn();
		existing.addEventListener('change', listener);
		const userState = { id: 42 };
		Reflect.set(existing, 'userState', userState);
		existing.setAttribute('value', 'before');
		root.appendChild(existing);
		const calls: string[] = [];
		class Counter extends document.HTMLElement {
			static override observedAttributes = ['value'];
			initialized = true;
			constructor() {
				super();
				calls.push('construct');
			}
			attributeChangedCallback(name: string, old: string | null, value: string): void {
				calls.push(`${name}:${old}:${value}`);
			}
			connectedCallback(): void {
				calls.push('connected');
			}
		}
		document.customElements.define('x-counter', Counter);
		expect(root.firstChild).toBe(existing);
		expect(existing).toBeInstanceOf(Counter);
		expect(existing.firstChild).toBe(text);
		expect(Reflect.get(existing, 'userState')).toBe(userState);
		existing.dispatchEvent(new Event('change'));
		expect(listener).toHaveBeenCalledOnce();
		expect(calls).toEqual(['construct', 'value:null:before', 'connected']);
	});
	it('orders disconnect, adoption, connect and attributes across documents', () => {
		const { document, root } = setup();
		const second = setup();
		const calls: string[] = [];
		class Item extends document.HTMLElement {
			static override observedAttributes = ['state'];
			connectedCallback(): void {
				calls.push('connected');
			}
			disconnectedCallback(): void {
				calls.push('disconnected');
			}
			adoptedCallback(old: Document, next: Document): void {
				expect(old).toBe(document);
				expect(next).toBe(second.document);
				calls.push('adopted');
			}
			attributeChangedCallback(name: string, old: string | null, value: string | null): void {
				calls.push(`${name}:${old}:${value}`);
			}
		}
		document.customElements.define('x-item', Item);
		const item = new Item();
		root.appendChild(item);
		item.setAttribute('state', 'one');
		second.root.appendChild(item);
		item.removeAttribute('state');
		expect(calls).toEqual([
			'connected',
			'state:null:one',
			'disconnected',
			'adopted',
			'connected',
			'state:one:null',
		]);
		expect(item.ownerDocument).toBe(second.document);
	});
	it('handles reentrant lifecycle mutations and reports callback exceptions', () => {
		const errors: unknown[] = [];
		const document = new Document({ reportError: (error) => errors.push(error) });
		const root = document.createElement('screen');
		document.appendChild(root);
		const calls: string[] = [];
		class Item extends document.HTMLElement {
			connectedCallback(): void {
				calls.push('connected');
				this.remove();
				// oxlint-disable-next-line bombshell-dev/no-generic-error -- Deliberately throw a user callback exception to verify reporting.
				throw new TypeError('callback');
			}
			disconnectedCallback(): void {
				calls.push('disconnected');
			}
		}
		document.customElements.define('x-item', Item);
		const item = new Item();
		root.appendChild(item);
		expect(calls).toEqual(['connected', 'disconnected']);
		expect(errors).toHaveLength(1);
		expect(item.parentNode).toBeNull();
	});
	it('upgrades each element in a subtree exactly once on connection', () => {
		const { document, root } = setup();
		const calls: string[] = [];
		const parent = document.createElement('x-item');
		const child = document.createElement('x-item');
		parent.appendChild(child);
		class Item extends document.HTMLElement {
			connectedCallback(): void {
				calls.push(this === parent ? 'parent' : 'child');
			}
		}
		document.customElements.define('x-item', Item);
		root.appendChild(parent);
		expect(calls).toEqual(['parent', 'child']);
	});
	it('keeps registries independent and supports explicit detached upgrades', async () => {
		const first = setup();
		const second = setup();
		class First extends first.document.HTMLElement {}
		class Second extends second.document.HTMLElement {}
		const waiting = first.document.customElements.whenDefined('x-item');
		const item = first.document.createElement('x-item');
		first.document.customElements.define('x-item', First);
		second.document.customElements.define('x-item', Second);
		expect(await waiting).toBe(First);
		expect(item).not.toBeInstanceOf(First);
		first.document.customElements.upgrade(item);
		expect(item).toBeInstanceOf(First);
		expect(second.document.createElement('x-item')).toBeInstanceOf(Second);
		expect(() => first.document.customElements.define('x-item', First)).toThrow();
		expect(() => first.document.customElements.define('bad', First)).toThrow();
	});
});

describe('templates, parsing and slots', () => {
	it('constructs parsed custom elements after their attributes and descendants exist', () => {
		const { document, root } = setup();
		installParsing(document);
		const calls: unknown[][] = [];
		class Item extends document.HTMLElement {
			static override observedAttributes = ['value'];
			constructor() {
				super();
				calls.push(['construct', this.getAttribute('value'), this.textContent, this.isConnected]);
			}
			attributeChangedCallback(_name: string, old: string | null, value: string): void {
				calls.push(['attribute', old, value]);
			}
			connectedCallback(): void {
				calls.push(['connected', this.textContent]);
			}
		}
		document.customElements.define('x-item', Item);
		const detached = document.createElement('box');
		detached.innerHTML = '<x-item value="one">detached</x-item>';
		expect(calls).toEqual([
			['construct', 'one', 'detached', false],
			['attribute', null, 'one'],
		]);
		calls.length = 0;
		root.innerHTML = '<x-item value="two">connected</x-item>';
		expect(calls).toEqual([
			['construct', 'two', 'connected', true],
			['attribute', null, 'two'],
			['connected', 'connected'],
		]);
	});
	it('upgrades parsed parents before descendants and exposes the complete parsed tree', () => {
		const { document, root } = setup();
		installParsing(document);
		const calls: string[] = [];
		class Item extends document.HTMLElement {
			constructor() {
				super();
				calls.push(`${this.id}:${this.textContent}`);
			}
		}
		document.customElements.define('x-item', Item);
		root.innerHTML = '<x-item id="parent"><x-item id="child">text</x-item></x-item>';
		expect(calls).toEqual(['parent:text', 'child:text']);
	});
	it('keeps custom elements inert when parsing directly into a template', () => {
		const { document, root } = setup();
		installParsing(document);
		const calls: string[] = [];
		class Item extends document.HTMLElement {
			constructor() {
				super();
				calls.push('constructed');
			}
			connectedCallback(): void {
				calls.push('connected');
			}
		}
		document.customElements.define('x-item', Item);
		const template = document.createElement('template');
		template.innerHTML = '<x-item><span>value</span></x-item>';
		expect(calls).toEqual([]);
		expect(template.content.firstChild).not.toBeInstanceOf(Item);
		root.appendChild(template.content);
		expect(calls).toEqual(['constructed', 'connected']);
		expect(root.firstChild).toBeInstanceOf(Item);
	});
	it('opts parsing in without executing scripts and uses inert template contents', () => {
		const { document, root } = setup();
		installParsing(document);
		root.innerHTML =
			'<template><box data-value="&amp;">hello<!--mark--></box></template><script>throw 1</script>';
		const template = root.firstChild;
		expect(template).toBeInstanceOf(HTMLTemplateElement);
		assert(template instanceof HTMLTemplateElement);
		expect(template.childNodes).toHaveLength(0);
		expect(template.content.textContent).toBe('hello');
		expect(template.content.ownerDocument).not.toBe(document);
		expect(template.content.firstChild?.isConnected).toBe(false);
		const imported = document.importNode(template.content, true);
		root.appendChild(imported);
		expect(root.lastChild?.ownerDocument).toBe(document);
		expect(root.lastChild?.textContent).toBe('hello');
		expect(template.innerHTML).toBe('<box data-value="&amp;">hello<!--mark--></box>');
	});
	it('deep clones nested templates and preserves comments, namespaces and traversal', () => {
		const { document } = setup();
		installParsing(document);
		const template = document.createElement('template');
		template.innerHTML =
			'<svg><circle/></svg><!--marker--><template><text>nested</text></template>';
		const clone = document.importNode(template, true);
		expect(clone).toBeInstanceOf(HTMLTemplateElement);
		assert(clone instanceof HTMLTemplateElement);
		expect(clone.content.firstChild).not.toBe(template.content.firstChild);
		const svg = clone.content.firstChild;
		expect(svg instanceof Element && svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
		const walker = document.createTreeWalker(clone.content, 129);
		const names: string[] = [];
		for (let node = walker.nextNode(); node; node = walker.nextNode()) names.push(node.nodeName);
		expect(names).toEqual(['svg', 'circle', '#comment', 'TEMPLATE']);
		const nested = clone.content.lastChild;
		expect(nested instanceof HTMLTemplateElement && nested.content.textContent).toBe('nested');
	});
	it('assigns named/default slots, fallback and coalesced slotchange', async () => {
		const { document, root } = setup();
		const host = document.createElement('x-host');
		root.appendChild(host);
		const shadow = host.attachShadow({ mode: 'open' });
		const named = document.createElement('slot');
		named.name = 'label';
		const fallback = document.createTextNode('fallback');
		named.appendChild(fallback);
		const main = document.createElement('slot');
		shadow.append(named, main);
		expect(named).toBeInstanceOf(HTMLSlotElement);
		expect(named.assignedNodes({ flatten: true })).toEqual([fallback]);
		const events = vi.fn();
		named.addEventListener('slotchange', events);
		const label = document.createElement('text');
		label.slot = 'label';
		const body = document.createTextNode('body');
		host.append(label, body);
		expect(label.assignedSlot).toBe(named);
		expect(named.assignedElements()).toEqual([label]);
		expect(main.assignedNodes()).toEqual([body]);
		label.slot = '';
		label.slot = 'label';
		await Promise.resolve();
		expect(events).toHaveBeenCalledOnce();
		expect(label.parentNode).toBe(host);
		expect(shadow.isConnected).toBe(true);
	});
});

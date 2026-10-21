import { beforeAll, describe, expect, it } from 'vitest';
import { Document, Element, Event, HTMLSlotElement, type Node } from '@bomb.sh/dom';
import { bundleFixture, FixtureRealm } from '@examples/dom-realm';

let bundle: string;
beforeAll(async () => {
	bundle = await bundleFixture(new URL('../src/component.js', import.meta.url));
});

function createFixture(): { document: Document; realm: FixtureRealm } {
	const document = new Document();
	document.appendChild(document.createElement('application'));
	const realm = new FixtureRealm(document);
	realm.run(bundle);
	return { document, realm };
}

function findElement(root: Node | null | undefined, name: string): Element | undefined {
	for (const child of root?.childNodes ?? []) {
		if (child instanceof Element && child.localName === name) return child;
		const nested = findElement(child, name);
		if (nested) return nested;
	}
}

function counter(document: Document): Element {
	const element = document.documentElement?.firstChild;
	if (!(element instanceof Element)) expect.fail('Counter was not mounted');
	return element;
}

describe('Lit 3 browser runtime in a persistent document realm', () => {
	it('upgrades an existing connected custom element without replacing it', async () => {
		const document = new Document();
		const root = document.createElement('application');
		const existing = document.createElement('terminal-counter');
		existing.setAttribute('count', '7');
		root.append(existing);
		document.append(root);
		const realm = new FixtureRealm(document);
		realm.run(bundle);
		await realm.run('document.documentElement.firstChild.updateComplete');
		expect(root.firstChild).toBe(existing);
		expect(realm.run('document.documentElement.firstChild instanceof fixture.Counter')).toBe(true);
		expect(existing.shadowRoot?.textContent?.trim()).toBe('7');
	});

	it('constructs a real LitElement and renders/reacts asynchronously in a shadow root', async () => {
		const { document, realm } = createFixture();
		await realm.run('fixture.mount()');
		const element = counter(document);
		expect(element.localName).toBe('terminal-counter');
		expect(element.shadowRoot?.textContent?.trim()).toBe('0');
		expect(realm.run('fixture.counter instanceof fixture.Counter')).toBe(true);
		await realm.run('fixture.setCount(5)');
		expect(element.shadowRoot?.textContent?.trim()).toBe('5');
		expect(element.getAttribute('count')).toBe('5');
		await realm.run('fixture.attributeCount(8)');
		expect(element.shadowRoot?.textContent?.trim()).toBe('8');
	});

	it('dispatches real listeners, composes slots, and preserves reconnect identity', async () => {
		const { document, realm } = createFixture();
		await realm.run('fixture.mount()');
		const element = counter(document);
		const button = findElement(element.shadowRoot, 'button');
		expect(button).not.toBeNull();
		button?.dispatchEvent(new Event('click', { bubbles: true, composed: true }));
		await realm.run('fixture.counter.updateComplete');
		expect(element.shadowRoot?.textContent?.trim()).toBe('1');
		const slot = findElement(element.shadowRoot, 'slot');
		expect(slot).toBeInstanceOf(HTMLSlotElement);
		if (slot instanceof HTMLSlotElement) expect(slot.assignedNodes()).toEqual([element.firstChild]);
		realm.run('fixture.remove()');
		expect(element.isConnected).toBe(false);
		expect(realm.run('fixture.lifecycle.join(",")')).toBe('connected,disconnected');
		await realm.run('fixture.mount()');
		expect(counter(document)).toBe(element);
		expect(findElement(element.shadowRoot, 'button')).toBe(button);
		expect(realm.run('fixture.lifecycle.join(",")')).toBe('connected,disconnected,connected');
	});

	it('isolates simultaneous asynchronous updates without ambient globals', async () => {
		const first = createFixture();
		const second = createFixture();
		await Promise.all([first.realm.run('fixture.mount()'), second.realm.run('fixture.mount()')]);
		await Promise.all([
			first.realm.run('fixture.setCount(11)'),
			second.realm.run('fixture.setCount(22)'),
		]);
		expect(counter(first.document).shadowRoot?.textContent?.trim()).toBe('11');
		expect(counter(second.document).shadowRoot?.textContent?.trim()).toBe('22');
		expect(counter(first.document).ownerDocument).toBe(first.document);
		expect(counter(second.document).ownerDocument).toBe(second.document);
		expect(Reflect.has(globalThis, 'document')).toBe(false);
		expect(Reflect.has(globalThis, 'window')).toBe(false);
	});
});

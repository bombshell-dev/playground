import { beforeAll, describe, expect, it } from 'vitest';
import { Document, Element, Event, type Node } from '@bomb.sh/dom';
import { FixtureRealm } from '@examples/dom-realm';
import { compileFixture } from '../src/compile.ts';

let bundle: string;
beforeAll(async () => {
	bundle = await compileFixture();
});

function createFixture(): { document: Document; realm: FixtureRealm } {
	const document = new Document();
	document.appendChild(document.createElement('application'));
	const realm = new FixtureRealm(document);
	realm.run(bundle);
	return { document, realm };
}

function findElement(
	root: Node | null | undefined,
	predicate: (element: Element) => boolean,
): Element | undefined {
	for (const child of root?.childNodes ?? []) {
		if (child instanceof Element && predicate(child)) return child;
		const nested = findElement(child, predicate);
		if (nested) return nested;
	}
}

describe('Svelte 5 compiled client component in a persistent document realm', () => {
	it('mounts, updates keyed nodes and text, handles input, and cleans up', async () => {
		const { document, realm } = createFixture();
		const sibling = document.createElement('sibling');
		sibling.textContent = 'untouched';
		document.documentElement?.appendChild(sibling);
		await realm.run('fixture.mount()');
		const root = document.documentElement;
		expect(root?.textContent).toContain('initial');
		const a = findElement(root, (element) => element.getAttribute('data-key') === 'a');
		const label = findElement(root, (element) => element.localName === 'text')?.firstChild;
		expect(a).not.toBeNull();
		await realm.run('fixture.update("updated")');
		expect(root?.textContent).toContain('updated');
		expect(findElement(root, (element) => element.localName === 'box')?.getAttribute('title')).toBe(
			'updated',
		);
		expect(sibling.textContent).toBe('untouched');
		expect(findElement(root, (element) => element.getAttribute('data-key') === 'a')).toBe(a);
		expect(findElement(root, (element) => element.localName === 'text')?.firstChild).toBe(label);
		const button = findElement(root, (element) => element.localName === 'button');
		button?.dispatchEvent(new Event('click', { bubbles: true, composed: true }));
		await realm.run('fixture.settle()');
		expect(button?.textContent).toBe('1');
		expect(realm.run('fixture.lifecycle.join(",")')).toBe('mounted');
		await realm.run('fixture.unmount()');
		expect(root?.childNodes).toEqual([sibling]);
		expect(root?.textContent).toBe('untouched');
		expect(realm.run('fixture.lifecycle.join(",")')).toBe('mounted,cleanup');
	});

	it('keeps asynchronous updates in two documents independent without global swapping', async () => {
		const first = createFixture();
		const second = createFixture();
		await Promise.all([first.realm.run('fixture.mount()'), second.realm.run('fixture.mount()')]);
		await Promise.all([
			first.realm.run('fixture.update("first")'),
			second.realm.run('fixture.update("second")'),
		]);
		expect(first.document.documentElement?.textContent).toContain('first');
		expect(second.document.documentElement?.textContent).toContain('second');
		expect(
			findElement(first.document, (element) => element.localName === 'button')?.ownerDocument,
		).toBe(first.document);
		expect(
			findElement(second.document, (element) => element.localName === 'button')?.ownerDocument,
		).toBe(second.document);
		expect(Reflect.has(globalThis, 'document')).toBe(false);
		expect(Reflect.has(globalThis, 'window')).toBe(false);
		await Promise.all([
			first.realm.run('fixture.unmount()'),
			second.realm.run('fixture.unmount()'),
		]);
	});
});

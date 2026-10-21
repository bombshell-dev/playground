import { describe, expect, it, vi } from 'vitest';
import { Document, MutationObserver, type MutationRecord } from '../src/index.ts';

describe('MutationObserver', () => {
	it('rejects a non-node observation target at runtime', () => {
		const observer = new MutationObserver(() => {});
		expect(() => Reflect.apply(observer.observe, observer, [{}, { childList: true }])).toThrow(
			TypeError,
		);
	});

	it('reports callback errors through the document host without aborting other deliveries', async () => {
		const reportError = vi.fn();
		const document = new Document({ reportError });
		const element = document.createElement('box');
		const failure = new TypeError('observer failure');
		const failing = new MutationObserver(() => {
			throw failure;
		});
		const following = vi.fn();
		const successful = new MutationObserver(following);
		failing.observe(element, { attributes: true });
		successful.observe(element, { attributes: true });
		element.setAttribute('id', 'updated');
		await Promise.resolve();
		expect(reportError).toHaveBeenCalledWith(failure);
		expect(following).toHaveBeenCalledOnce();
		failing.disconnect();
		successful.disconnect();
	});

	it('observes explicitly targeted detached trees without invalidating the host', async () => {
		const invalidate = vi.fn();
		const document = new Document({ onInvalidate: invalidate });
		const container = document.createElement('box');
		const child = document.createTextNode('before');
		container.appendChild(child);
		const callback = vi.fn();
		const observer = new MutationObserver(callback);
		observer.observe(container, {
			subtree: true,
			characterData: true,
			characterDataOldValue: true,
			childList: true,
		});
		child.data = 'after';
		container.appendChild(document.createComment('comment'));
		expect(callback).not.toHaveBeenCalled();
		expect(invalidate).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(callback).toHaveBeenCalledOnce();
		expect(callback.mock.calls[0]?.[0]).toMatchObject([
			{ type: 'characterData', target: child, oldValue: 'before' },
			{ type: 'childList', target: container, previousSibling: child, nextSibling: null },
		]);
		observer.disconnect();
	});

	it('preserves child-list snapshots and sibling positions', () => {
		const document = new Document();
		const parent = document.createElement('box');
		const first = document.createElement('first');
		const second = document.createElement('second');
		const inserted = document.createElement('inserted');
		parent.append(first, second);
		const observer = new MutationObserver(() => {});
		observer.observe(parent, { childList: true });
		parent.insertBefore(inserted, second);
		inserted.remove();
		const records = observer.takeRecords();
		expect(records[0]).toMatchObject({
			target: parent,
			addedNodes: [inserted],
			removedNodes: [],
			previousSibling: first,
			nextSibling: second,
		});
		expect(records[1]).toMatchObject({
			target: parent,
			addedNodes: [],
			removedNodes: [inserted],
			previousSibling: first,
			nextSibling: second,
		});
		expect(Object.isFrozen(records[0]?.addedNodes)).toBe(true);
		observer.disconnect();
	});

	it('filters attribute names and namespaces, preserves old values, and copies options', () => {
		const document = new Document();
		const element = document.createElement('box');
		element.setAttribute('value', 'initial');
		const names = ['value'];
		const observer = new MutationObserver(() => {});
		observer.observe(element, { attributeFilter: names, attributeOldValue: true });
		names.push('ignored');
		element.setAttribute('value', 'next');
		element.setAttribute('ignored', 'no');
		element.setAttributeNS('urn:test', 'test:value', 'namespaced');
		element.removeAttribute('value');
		expect(observer.takeRecords()).toMatchObject([
			{
				type: 'attributes',
				target: element,
				attributeName: 'value',
				attributeNamespace: null,
				oldValue: 'initial',
			},
			{ type: 'attributes', attributeName: 'value', oldValue: 'next' },
		]);
		observer.disconnect();
	});

	it('defaults attributes/characterData from old-value options, including false', () => {
		const document = new Document();
		const element = document.createElement('box');
		const text = document.createTextNode('before');
		const observer = new MutationObserver(() => {});
		observer.observe(element, { attributeOldValue: false });
		observer.observe(text, { characterDataOldValue: false });
		element.setAttribute('id', 'a');
		text.data = 'after';
		expect(observer.takeRecords().map((record) => [record.type, record.oldValue])).toEqual([
			['attributes', null],
			['characterData', null],
		]);
		observer.disconnect();
	});

	it.each([
		{},
		{ attributes: false, attributeOldValue: true },
		{ attributes: false, attributeFilter: [], childList: true },
		{ characterData: false, characterDataOldValue: true },
	])('rejects contradictory or empty options %j', (options) => {
		const observer = new MutationObserver(() => {});
		expect(() => observer.observe(new Document(), options)).toThrow(TypeError);
	});

	it('deduplicates overlapping registrations and includes oldValue requested by either', () => {
		const document = new Document();
		const parent = document.createElement('box');
		const child = document.createElement('text');
		parent.append(child);
		child.setAttribute('id', 'old');
		const observer = new MutationObserver(() => {});
		observer.observe(parent, { attributes: true, subtree: true });
		observer.observe(child, { attributes: true, attributeOldValue: true });
		child.setAttribute('id', 'new');
		expect(observer.takeRecords()).toMatchObject([{ oldValue: 'old' }]);
		observer.disconnect();
	});

	it('updates a registration and disconnect discards queued records', async () => {
		const document = new Document();
		const element = document.createElement('box');
		const callback = vi.fn();
		const observer = new MutationObserver(callback);
		observer.observe(element, { attributes: true });
		observer.observe(element, { childList: true });
		element.setAttribute('id', 'a');
		expect(observer.takeRecords()).toEqual([]);
		element.append('child');
		observer.disconnect();
		await Promise.resolve();
		expect(callback).not.toHaveBeenCalled();
		element.append('another');
		expect(observer.takeRecords()).toEqual([]);
	});

	it('retains removed subtree observation through delivery, then stops', async () => {
		const document = new Document();
		const parent = document.createElement('box');
		const child = document.createElement('text');
		parent.append(child);
		const deliveries: MutationRecord[][] = [];
		const observer = new MutationObserver((records) => deliveries.push(records));
		observer.observe(parent, { childList: true, subtree: true, attributes: true });
		child.remove();
		child.setAttribute('id', 'observed');
		await Promise.resolve();
		expect(deliveries[0]?.map((record) => record.type)).toEqual(['childList', 'attributes']);
		child.setAttribute('id', 'unobserved');
		await Promise.resolve();
		expect(deliveries).toHaveLength(1);
		observer.disconnect();
	});

	it('clears transient registrations even if childList was not observed', async () => {
		const document = new Document();
		const parent = document.createElement('box');
		const child = document.createElement('text');
		parent.append(child);
		const callback = vi.fn();
		const observer = new MutationObserver(callback);
		observer.observe(parent, { subtree: true, attributes: true });
		child.remove();
		await Promise.resolve();
		child.setAttribute('id', 'unobserved');
		await Promise.resolve();
		expect(callback).not.toHaveBeenCalled();
		observer.disconnect();
	});

	it('takeRecords drains records without clearing transient observations', async () => {
		const document = new Document();
		const parent = document.createElement('box');
		const child = document.createElement('text');
		parent.append(child);
		const callback = vi.fn();
		const observer = new MutationObserver(callback);
		observer.observe(parent, { subtree: true, childList: true, attributes: true });
		child.remove();
		expect(observer.takeRecords()).toHaveLength(1);
		child.setAttribute('id', 'retained');
		await Promise.resolve();
		expect(callback.mock.calls[0]?.[0]).toMatchObject([{ type: 'attributes' }]);
		observer.disconnect();
	});

	it('uses per-observer delivery snapshots under reentrant mutation', async () => {
		const document = new Document();
		const element = document.createElement('box');
		const delivered: string[] = [];
		const first = new MutationObserver(function (records, observer) {
			expect(this).toBe(observer);
			delivered.push(`first:${records.map((record) => record.attributeName).join(',')}`);
			if (records[0]?.attributeName === 'a') element.setAttribute('b', '2');
		});
		const second = new MutationObserver((records) =>
			delivered.push(`second:${records.map((record) => record.attributeName).join(',')}`),
		);
		first.observe(element, { attributes: true });
		second.observe(element, { attributes: true });
		element.setAttribute('a', '1');
		await Promise.resolve();
		expect(delivered).toEqual(['first:a', 'second:a,b']);
		await Promise.resolve();
		expect(delivered).toEqual(['first:a', 'second:a,b', 'first:b']);
		first.disconnect();
		second.disconnect();
	});
});

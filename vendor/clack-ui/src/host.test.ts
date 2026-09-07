import { expect, expectTypeOf, test } from 'vitest';
import { destroy } from './core.ts';
import { emit } from './emit.ts';
import { createHost } from './host.ts';
import type { HostEvent, HostEventListener } from './events.ts';

declare module './events.ts' {
	interface HostEvents {
		__proto__: HostEvent<'__proto__'>;
	}
}

test('custom event names cannot collide with inherited object properties', () => {
	const host = createHost();
	const seen: string[] = [];
	const listener: HostEventListener<'__proto__'> = (event) => seen.push(event.type);
	try {
		host.addEventListener(host.element, '__proto__', listener);
		emit(host.root, { type: '__proto__' });
		expect(seen).toEqual(['__proto__']);
		host.removeEventListener(host.element, '__proto__', listener);
		emit(host.root, { type: '__proto__' });
		expect(seen).toEqual(['__proto__']);
	} finally {
		destroy(host.root);
	}
});

test('typed listeners receive their event and changes apply on the next dispatch', () => {
	const host = createHost();
	const seen: string[] = [];
	const later: HostEventListener<'input'> = (event) => {
		seen.push(`later: ${event.value}`);
	};
	const first: HostEventListener<'input'> = (event) => {
		seen.push(`first: ${event.value}`);
		host.removeEventListener(host.element, 'input', first);
		host.addEventListener(host.element, 'input', later);
	};
	try {
		host.addEventListener(host.element, 'input', first);
		emit(host.root, { type: 'input', value: 'A' });
		expect(seen).toEqual(['first: A']);
		emit(host.root, { type: 'input', value: 'B' });
		expect(seen).toEqual(['first: A', 'later: B']);
		host.removeEventListener(host.element, 'input', later);
		emit(host.root, { type: 'input', value: 'C' });
		expect(seen).toEqual(['first: A', 'later: B']);
		expectTypeOf<{ type: 'input' }>().not.toExtend<Parameters<typeof emit>[1]>();
	} finally {
		destroy(host.root);
	}
});

import { expect, expectTypeOf, test } from 'vitest';
import { createApi } from './api.ts';
import { create, destroy } from './lifecycle.ts';

const api = createApi('typed-middleware-test', {
	increment(_node, value: number): number {
		return value + 1;
	},
	label(_node, value: string): string {
		return `Label: ${value}`;
	},
});

test('middleware preserves member signatures and updates inherited handles', () => {
	const parent = create();
	const child = create(parent);
	try {
		api.around(parent, { increment: ([node, value], next) => next(node, value * 2) });
		api.around(child, { increment: ([node, value], next) => next(node, value + 3) });
		expect(api.methods.increment(child, 1)).toBe(6);
		expect(api.invoke('label', [child, 'hello'])).toBe('Label: hello');

		api.around(parent, { increment: ([node, value], next) => next(node, value) + 10 });
		expect(api.methods.increment(child, 1)).toBe(16);
		expect(api.methods.increment(parent, 1)).toBe(13);
		expectTypeOf(api.methods.increment).parameter(1).toEqualTypeOf<number>();
		expectTypeOf(api.methods.label).returns.toEqualTypeOf<string>();
	} finally {
		destroy(parent);
	}
});

test('an omitted middleware does not replace an installed member', () => {
	const node = create();
	try {
		api.around(node, { increment: ([target, value], next) => next(target, value * 2) });
		api.around(node, { increment: undefined });
		expect(api.methods.increment(node, 4)).toBe(9);
	} finally {
		destroy(node);
	}
});

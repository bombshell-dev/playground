import { describe, expect, test } from 'vitest';
import { text } from './components/text.ts';
import { normalizeChildren, stringifyPrimitive } from './children.ts';

// `@bomb.sh/tty` OP_TEXT directive.
const TEXT = 3;

describe('stringifyPrimitive', () => {
	test('keeps strings and numbers (incl. 0 and ""), drops nullish and booleans', () => {
		expect(stringifyPrimitive('a')).toBe('a');
		expect(stringifyPrimitive(0)).toBe('0');
		expect(stringifyPrimitive('')).toBe('');
		expect(stringifyPrimitive(null)).toBeUndefined();
		expect(stringifyPrimitive(undefined)).toBeUndefined();
		expect(stringifyPrimitive(true)).toBeUndefined();
		expect(stringifyPrimitive(false)).toBeUndefined();
	});
});

describe('normalizeChildren — React JSX coercion', () => {
	test('strings and numbers become text ops', () => {
		expect(normalizeChildren(['hi', 42])).toMatchObject([
			{ directive: TEXT, content: 'hi' },
			{ directive: TEXT, content: '42' },
		]);
	});

	test('keeps 0 and empty string — the drop is nullish/boolean, not falsy', () => {
		expect(normalizeChildren([0, '', false, null, undefined, true])).toMatchObject([
			{ directive: TEXT, content: '0' },
			{ directive: TEXT, content: '' },
		]);
	});

	test('flattens arrays recursively', () => {
		expect(normalizeChildren(['a', ['b', ['c']]])).toMatchObject([
			{ content: 'a' },
			{ content: 'b' },
			{ content: 'c' },
		]);
	});

	test('passes existing ops through by reference, untouched', () => {
		const t = text({ color: 9 }, 'x');
		const ops = normalizeChildren(['a', t]);
		expect(ops[0]).toMatchObject({ directive: TEXT, content: 'a' });
		expect(ops[1]).toBe(t);
	});
});

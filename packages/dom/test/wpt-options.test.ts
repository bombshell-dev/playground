import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { Document } from '../src/dom.ts';

describe('upstream WPT: option-selected.html', () => {
	const source = readFileSync(new URL('./wpt/option-selected.html.txt', import.meta.url), 'utf8');
	const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)];
	for (const script of scripts) {
		runInNewContext(
			script[1] ?? '',
			{
				document: new Document(),
				test(callback: () => void, name: string): void {
					it(name, callback);
				},
				// oxlint-disable-next-line bombshell-dev/max-params -- WPT testharness API.
				assert_equals(actual: unknown, expected: unknown, message?: string): void {
					expect(actual, message).toBe(expected);
				},
			},
			{ filename: 'option-selected.html' },
		);
	}
});

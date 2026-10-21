import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { Event, EventTarget } from '../src/events.ts';

interface AsyncTest {
	step_func<Args extends unknown[]>(callback: (...args: Args) => void): (...args: Args) => void;
	done(): void;
}

// These are unchanged upstream test files, pinned and licensed in wpt/README.md.
// The sandbox exposes only the tested constructors and a minimal testharness API.
// It does not install globals into the package or the surrounding Node process.
for (const file of [
	'AddEventListenerOptions-once.any.js',
	'AddEventListenerOptions-passive.any.js',
	'AddEventListenerOptions-signal.any.js',
]) {
	describe(`upstream WPT: ${file}`, () => {
		const listenerErrors: unknown[] = [];
		class HarnessEventTarget extends EventTarget {
			constructor() {
				super({ reportError: (error) => listenerErrors.push(error) });
			}
		}
		const verifyListenerErrors = (): void => {
			expect(listenerErrors, 'WPT assertions thrown in event listeners').toEqual([]);
		};
		const context = {
			Event,
			EventTarget: HarnessEventTarget,
			AbortController,
			AbortSignal,
			TypeError,
			test(callback: () => void, name: string): void {
				it(name, () => {
					listenerErrors.length = 0;
					callback();
					verifyListenerErrors();
				});
			},
			async_test(callback: (test: AsyncTest) => void, name: string): void {
				it(name, async () => {
					listenerErrors.length = 0;
					await new Promise<void>((resolve, reject) => {
						callback({
							step_func:
								(step) =>
								(...args) => {
									try {
										step(...args);
									} catch (error) {
										reject(error);
									}
								},
							done: resolve,
						});
					});
					verifyListenerErrors();
				});
			},
			// oxlint-disable-next-line bombshell-dev/max-params -- WPT testharness API.
			assert_equals(actual: unknown, expected: unknown, message?: string): void {
				expect(actual, message).toBe(expected);
			},
			assert_true(actual: unknown, message?: string): void {
				expect(actual, message).toBe(true);
			},
			assert_false(actual: unknown, message?: string): void {
				expect(actual, message).toBe(false);
			},
			assert_unreached(message?: string): void {
				expect.unreachable(message);
			},
			// oxlint-disable-next-line bombshell-dev/max-params -- WPT testharness API.
			assert_throws_js(
				constructor: new (...args: never[]) => Error,
				callback: () => void,
				message?: string,
			): void {
				expect(callback, message).toThrow(constructor);
			},
		};
		const source = readFileSync(new URL(`./wpt/${file}.txt`, import.meta.url), 'utf8');
		runInNewContext(source, context, { filename: file });
	});
}

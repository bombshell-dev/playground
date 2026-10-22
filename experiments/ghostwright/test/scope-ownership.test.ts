import { expect, test } from 'bun:test';
import {
	call,
	createContext,
	ensure,
	run,
	scoped,
	spawn,
	suspend,
	useAbortSignal,
	useScope,
	withResolvers,
} from 'effection';
import { withTerminal, type EffectionTerminal } from '../src/effection/index.ts';
import {
	launchTerminal,
	expectTerminal,
	GhostwrightError,
	type KeyboardMiddleware,
} from '../src/index.ts';

const options = {
	command: process.execPath,
	args: [
		'-e',
		'process.stdin.setRawMode(true); process.stdin.on("data", b => process.stdout.write(b)); process.stdout.write("READY")',
	],
	trace: 'off' as const,
};

test('native withTerminal releases each session before returning to a still-live caller', async () => {
	await run(function* () {
		const parent = yield* useAbortSignal();
		let escaped!: EffectionTerminal;
		const result = yield* withTerminal(options, function* (terminal) {
			escaped = terminal;
			yield* terminal.screen.findByText('READY');
			return 42;
		});
		expect(result).toBe(42);
		expect(parent.aborted).toBe(false);
		expect(escaped.signal.aborted).toBe(true);
		expect(escaped.process.status().state).toBe('closed');
		expect(() => process.kill(escaped.process.status().pid!, 0)).toThrow();
	});
});

test('halting a native query releases its subscriptions before the parent continues', async () => {
	await run(() =>
		withTerminal(options, function* (terminal) {
			yield* terminal.screen.findByText('READY');
			const observations = terminal.inner.session.observations;
			const subscribe = observations.subscribe.bind(observations);
			let subscriptions = 0;
			observations.subscribe = (listener) => {
				subscriptions++;
				const off = subscribe(listener);
				return () => {
					subscriptions--;
					off();
				};
			};
			const entered = withResolvers<void>();
			const child = yield* spawn(() =>
				terminal.waitFor(() => {
					entered.resolve();
					throw new GhostwrightError({ code: 'TEST_NOT_READY', message: 'not ready' });
				}),
			);
			yield* entered.operation;
			expect(subscriptions).toBe(1);
			yield* child.halt();
			expect(subscriptions).toBe(0);
			expect(terminal.signal.aborted).toBe(false);
			yield* terminal.keyboard.press('a');
		}),
	);
});

test('concurrent native callers inherit their own context and isolate middleware resources', async () => {
	const context = createContext('scope-audit-context', 'parent');
	const entered = withResolvers<void>();
	const release = withResolvers<void>();
	const events: string[] = [];
	const middleware: KeyboardMiddleware = {
		*press(args, next) {
			const label = yield* context.expect();
			events.push(`${label}:enter`);
			yield* ensure(() => {
				events.push(`${label}:cleanup`);
			});
			if (label === 'first') {
				entered.resolve();
				yield* release.operation;
			}
			return yield* next(...args);
		},
	};
	await run(() =>
		withTerminal({ ...options, keyboardMiddleware: [middleware] }, function* (terminal) {
			yield* terminal.screen.findByText('READY');
			const parent = yield* useScope();
			const first = yield* spawn(function* () {
				yield* context.set('first');
				yield* terminal.keyboard.press('a');
			});
			yield* entered.operation;
			yield* scoped(function* () {
				yield* context.set('second');
				yield* terminal.keyboard.press('b');
			});
			expect(events).toEqual(['first:enter', 'second:enter', 'second:cleanup']);
			expect(parent.get(context)).toBe('parent');
			release.resolve();
			yield* first;
			expect(events.at(-1)).toBe('first:cleanup');
		}),
	);
});

test('async programs deliberately run in their owner context, not an unrelated native caller', async () => {
	const context = createContext('scope-audit-async', 'default');
	await using terminal = await launchTerminal({
		...options,
		keyboardMiddleware: [
			{
				*press(args, next) {
					expect(yield* context.expect()).toBe('default');
					return yield* next(...args);
				},
			},
		],
	});
	await terminal.screen.findByText('READY');
	await run(function* () {
		yield* context.set('foreign');
		yield* call(() => terminal.keyboard.press('x'));
	});
});

test('owner disposal waits for gated ensure cleanup, including repeated disposal', async () => {
	const entered = Promise.withResolvers<void>();
	const cleaning = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const events: string[] = [];
	const terminal = await launchTerminal({
		...options,
		keyboardMiddleware: [
			{
				*press(args, next) {
					yield* ensure(function* () {
						events.push('cleanup:start');
						cleaning.resolve();
						yield* call(() => release.promise);
						events.push('cleanup:end');
					});
					entered.resolve();
					yield* suspend();
					return yield* next(...args);
				},
			},
		],
	});
	const pending = terminal.keyboard.press('x').catch((error) => error);
	await entered.promise;
	const first = terminal.close().then(() => {
		events.push('closed:first');
	});
	try {
		await cleaning.promise;
		const second = terminal.close().then(() => {
			events.push('closed:second');
		});
		expect(events).toEqual(['cleanup:start']);
		release.resolve();
		await Promise.all([first, second, pending]);
		expect(events.slice(0, 2)).toEqual(['cleanup:start', 'cleanup:end']);
		expect(events.slice(2).sort()).toEqual(['closed:first', 'closed:second']);
	} finally {
		release.resolve();
		await terminal.close();
	}
});

for (const kind of [
	'revision',
	'locator',
	'stable-locator',
	'stable-screen',
	'locator-click',
] as const) {
	test(`halting native ${kind} work removes low-level listeners`, async () => {
		await run(() =>
			withTerminal(options, function* (terminal) {
				yield* terminal.screen.findByText('READY');
				const session = terminal.inner.session;
				const subscribe = session.subscribe.bind(session);
				const entered = withResolvers<void>();
				let subscriptions = 0;
				session.subscribe = (listener) => {
					subscriptions++;
					const off = subscribe(listener);
					queueMicrotask(() => entered.resolve());
					return () => {
						subscriptions--;
						return off();
					};
				};
				const child = yield* spawn(function* () {
					if (kind === 'revision')
						yield* terminal.revisions.collect({ since: 0, until: () => false });
					else if (kind === 'locator')
						yield* expectTerminal(terminal.getByText('NEVER')).toBePresent();
					else if (kind === 'stable-locator')
						yield* expectTerminal(terminal.getByText('READY')).toBeStable({ settleMs: 1000 });
					else if (kind === 'stable-screen')
						yield* expectTerminal(terminal).toSatisfy(() => true, { settleMs: 1000 });
					else yield* terminal.getByText('NEVER').click();
				});
				yield* entered.operation;
				expect(subscriptions).toBe(1);
				yield* child.halt();
				expect(subscriptions).toBe(0);
				expect(terminal.signal.aborted).toBe(false);
			}),
		);
	});
}

test('native body failure releases resources before the outer scope catches it', async () => {
	await run(function* () {
		const failure = { reason: 'body' };
		let escaped!: EffectionTerminal;
		try {
			yield* withTerminal(options, function* (terminal) {
				escaped = terminal;
				yield* terminal.screen.findByText('READY');
				throw failure;
			});
		} catch (error) {
			expect(error).toBe(failure);
		}
		expect(escaped.signal.aborted).toBe(true);
		expect(escaped.process.status().state).toBe('closed');
	});
});

test('ensure cleanup already running on successful action completion survives owner shutdown', async () => {
	const cleaning = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const events: string[] = [];
	const terminal = await launchTerminal({
		...options,
		keyboardMiddleware: [
			{
				*press(args, next) {
					yield* ensure(function* () {
						events.push('cleaning');
						cleaning.resolve();
						yield* call(() => release.promise);
						events.push('cleaned');
					});
					return yield* next(...args);
				},
			},
		],
	});
	await terminal.screen.findByText('READY');
	const pending = terminal.keyboard.press('x').catch((error) => error);
	await cleaning.promise;
	const closing = terminal.close().then(() => {
		events.push('closed');
	});
	try {
		expect(events).toEqual(['cleaning']);
		release.resolve();
		await Promise.all([pending, closing]);
		expect(events).toEqual(['cleaning', 'cleaned', 'closed']);
	} finally {
		release.resolve();
		await terminal.close();
	}
});

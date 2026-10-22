import { expect, test } from 'bun:test';
import { call, createContext, run, scoped, suspend } from 'effection';
import {
	captureProgram,
	composeOperation,
	launchTerminal,
	regionLocator,
	textContains,
	type ExecutionOperations,
	type KeyboardMiddleware,
	type TerminalProgram,
} from '../src/index.ts';
import { withTerminal as withOperationTerminal } from '../src/effection/index.ts';

const screen = regionLocator({ column: 0, row: 0, width: 80, height: 24 });
const options = {
	command: process.execPath,
	args: [
		'-e',
		'process.stdin.setRawMode(true); process.stdin.on("data", b => process.stdout.write(b)); process.stdout.write("READY");',
	],
	trace: 'off' as const,
};

function around(label: string, events: string[]): KeyboardMiddleware {
	return {
		*press(args, next) {
			events.push(`${label}:before`);
			try {
				return yield* next(...args);
			} finally {
				events.push(`${label}:after`);
			}
		},
	};
}

test('operation composition preserves typed results, order, and failure identity', async () => {
	const events: string[] = [];
	const failure = { reason: 'driver failed' };
	const operation = composeOperation(
		function* (value: number) {
			events.push('driver');
			if (value < 0) throw failure;
			yield* call(() => Promise.resolve());
			return value * 2;
		},
		[
			function* ([value], next) {
				events.push('outer');
				try {
					return (yield* next(value + 1)) + 3;
				} finally {
					events.push('cleanup');
				}
			},
			function* (args, next) {
				events.push('inner');
				return yield* next(...args);
			},
		],
	);
	expect(await run(() => operation(2))).toBe(9);
	expect(events).toEqual(['outer', 'inner', 'driver', 'cleanup']);
	await expect(Promise.resolve(run(() => operation(-2)))).rejects.toBe(failure);
	expect(events.slice(-4)).toEqual(['outer', 'inner', 'driver', 'cleanup']);
});

for (const mode of ['async', 'effection'] as const) {
	test(`${mode} keyboard facade invokes middleware once and returns the real receipt`, async () => {
		const events: string[] = [];
		let sequence = 0;
		const middleware: KeyboardMiddleware = {
			*press([key], next) {
				expect(key).toBe('x');
				events.push('transform');
				const receipt = yield* next('y');
				sequence = receipt.actionSequence;
				return receipt;
			},
		};
		const configured = { ...options, keyboardMiddleware: [around('outer', events), middleware] };
		if (mode === 'async') {
			await using terminal = await launchTerminal(configured);
			await terminal.screen.findByText('READY');
			const receipt = await terminal.keyboard.press('x');
			expect(receipt.actionSequence).toBe(sequence);
			await terminal.screen.findByText('READYy');
		} else {
			await run(() =>
				withOperationTerminal(configured, function* (terminal) {
					yield* terminal.screen.findByText('READY');
					const receipt = yield* terminal.keyboard.press('x');
					expect(receipt.actionSequence).toBe(sequence);
					yield* terminal.screen.findByText('READYy');
				}),
			);
		}
		expect(events).toEqual(['outer:before', 'transform', 'outer:after']);
	});
}

test('native operation middleware resolves context at invocation, including nested scopes', async () => {
	const context = createContext<string>('keyboard-test-context', 'outer');
	const seen: string[] = [];
	await run(() =>
		withOperationTerminal(
			{
				...options,
				keyboardMiddleware: [
					{
						*press(args, next) {
							seen.push(yield* context.expect());
							return yield* next(...args);
						},
					},
				],
			},
			function* (terminal) {
				yield* terminal.screen.findByText('READY');
				yield* scoped(function* () {
					yield* context.set('inner');
					yield* terminal.keyboard.press('a');
				});
				yield* terminal.keyboard.press('b');
			},
		),
	);
	expect(seen).toEqual(['inner', 'outer']);
});

for (const mode of ['async', 'effection'] as const) {
	test(`${mode} capture programs inherit middleware and isolate nested overrides`, async () => {
		const events: string[] = [];
		let escaped!: ExecutionOperations;
		const program = captureProgram(
			{
				until: screen.satisfies(textContains('READYab')),
				keyboardMiddleware: [around('capture', events)],
			},
			function* (terminal) {
				escaped = terminal;
				yield* terminal.capture(
					{
						until: screen.satisfies(textContains('READYa')),
						keyboardMiddleware: [around('nested', events)],
					},
					function* (child) {
						yield* child.keyboard.press('a');
					},
				);
				yield* terminal.keyboard.press('b');
			},
		);
		const configured = { ...options, keyboardMiddleware: [around('root', events)] };
		if (mode === 'async') {
			await using terminal = await launchTerminal(configured);
			await terminal.screen.findByText('READY');
			const capture = await terminal.run(program);
			expect(capture.observations.at(-1)!.screen.lines[0]!.text).toContain('READYab');
			await expect(Promise.resolve(run(() => escaped.keyboard.press('!')))).rejects.toBeDefined();
			await terminal.keyboard.press('c');
		} else {
			await run(() =>
				withOperationTerminal(configured, function* (terminal) {
					yield* terminal.screen.findByText('READY');
					const capture = yield* terminal.run(program);
					expect(capture.observations.at(-1)!.screen.lines[0]!.text).toContain('READYab');
					let rejected = false;
					try {
						yield* escaped.keyboard.press('!');
					} catch {
						rejected = true;
					}
					expect(rejected).toBe(true);
					yield* terminal.keyboard.press('c');
				}),
			);
		}
		expect(events).toEqual([
			'root:before',
			'capture:before',
			'nested:before',
			'nested:after',
			'capture:after',
			'root:after',
			'root:before',
			'capture:before',
			'capture:after',
			'root:after',
			'root:before',
			'root:after',
		]);
	});
}

test('capture cancellation unwinds middleware before returning and leaves parent usable', async () => {
	let cleaned = false;
	let forwarded = false;
	await using terminal = await launchTerminal(options);
	await terminal.screen.findByText('READY');
	const program = captureProgram(
		{
			timeoutMs: 40,
			until: screen.satisfies(textContains('NEVER')),
			keyboardMiddleware: [
				{
					*press(args, next) {
						try {
							yield* suspend();
							forwarded = true;
							return yield* next(...args);
						} finally {
							yield* call(() =>
								Promise.resolve().then(() => {
									cleaned = true;
								}),
							);
						}
					},
				},
			],
		},
		function* (child) {
			yield* child.keyboard.press('x');
		},
	);
	await expect(terminal.run(program)).rejects.toMatchObject({ code: 'GW_CAPTURE_TIMEOUT' });
	expect(cleaned).toBe(true);
	expect(forwarded).toBe(false);
	await terminal.keyboard.press('z');
	await terminal.screen.findByText('READYz');
});

test('program failures are catchable and owner disposal cancels pending continuations', async () => {
	const terminal = await launchTerminal(options);
	try {
		await terminal.screen.findByText('READY');
		const failure = { reason: 'program failed' };
		const failing: TerminalProgram<never> = function* () {
			yield* call(() => Promise.reject(failure));
			throw failure;
		};
		await expect(terminal.run(failing)).rejects.toBe(failure);
		await terminal.keyboard.press('q');
		const entered = Promise.withResolvers<void>();
		let cleaned = false;
		const pending = terminal
			.run(function* () {
				try {
					entered.resolve();
					yield* suspend();
				} finally {
					cleaned = true;
				}
			})
			.catch((error) => error);
		await entered.promise;
		await terminal.close();
		expect(await pending).toBeDefined();
		expect(cleaned).toBe(true);
	} finally {
		await terminal.close();
	}
});

test('native capture cancellation interrupts a blocked driver write and preserves its parent', async () => {
	await run(() =>
		withOperationTerminal(
			{
				...options,
				args: [
					'-e',
					'process.stdin.setRawMode(true); process.stdout.write("READY"); setInterval(() => {}, 1000)',
				],
			},
			function* (terminal) {
				yield* terminal.screen.findByText('READY');
				let failure: unknown;
				try {
					yield* terminal.run(
						captureProgram(
							{
								timeoutMs: 40,
								until: screen.satisfies(textContains('NEVER')),
							},
							function* (child) {
								yield* child.keyboard.write(new Uint8Array(1024 * 1024));
							},
						),
					);
				} catch (error) {
					failure = error;
				}
				expect(failure).toMatchObject({ code: 'GW_CAPTURE_TIMEOUT' });
				expect(terminal.process.status().state).toBe('running');
				yield* terminal.process.signal('SIGTERM');
				yield* terminal.process.waitForExit();
			},
		),
	);
});

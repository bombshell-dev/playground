import { expect, test } from 'bun:test';
import { launchTerminal } from '../src/index.ts';

const options = {
	command: process.execPath,
	args: [
		'-e',
		String.raw`
		process.stdin.setRawMode(true);
		process.stdin.on('data', bytes => {
			if (bytes.includes(120)) process.exit(0);
			process.stdout.write('\r\nCHANGED');
		});
		process.stdout.write('READY');
	`,
	],
	trace: 'off' as const,
};

function gate<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

test('waitFor returns any normal result, including false, and awaits promises', async () => {
	await using terminal = await launchTerminal(options);
	const { waitFor } = terminal;
	expect(await waitFor(() => false, { timeoutMs: 0 })).toBe(false);
	expect(await waitFor(() => undefined)).toBeUndefined();
	expect(await waitFor(async () => 42)).toBe(42);
});

test('an observation retries a failed assertion without waiting for the interval', async () => {
	await using terminal = await launchTerminal(options);
	await terminal.screen.findByText('READY');
	const checked = gate<void>();
	const finding = terminal.waitFor(
		() => {
			checked.resolve();
			return terminal.screen.getByText('CHANGED');
		},
		{ intervalMs: 60_000, timeoutMs: 1000 },
	);
	await checked.promise;
	await terminal.keyboard.type('c');
	expect((await finding).text()).toBe('CHANGED');
});

test('interval retries notice nonterminal state even after the child exits', async () => {
	await using terminal = await launchTerminal(options);
	await terminal.screen.findByText('READY');
	await terminal.keyboard.type('x');
	await terminal.process.waitForExit();
	const checked = gate<void>();
	let ready = false;
	const waiting = terminal.waitFor(
		() => {
			checked.resolve();
			expect(ready).toBe(true);
			return 'external state ready';
		},
		{ intervalMs: 5 },
	);
	await checked.promise;
	ready = true;
	expect(await waiting).toBe('external state ready');
});

test('pending async callbacks never overlap despite terminal observations', async () => {
	await using terminal = await launchTerminal(options);
	await terminal.screen.findByText('READY');
	const entered = gate<void>();
	const release = gate<void>();
	let active = false;
	let overlapped = false;
	let ready = false;
	const waiting = terminal.waitFor(
		async () => {
			if (active) overlapped = true;
			active = true;
			entered.resolve();
			try {
				if (!ready) await release.promise;
				expect(ready).toBe(true);
				return 'done';
			} finally {
				active = false;
			}
		},
		{ intervalMs: 0 },
	);
	await entered.promise;
	await terminal.keyboard.type('c');
	await terminal.screen.findByText('CHANGED');
	ready = true;
	release.resolve();
	expect(await waiting).toBe('done');
	expect(overlapped).toBe(false);
});

test('a rejected async callback can recover on a later attempt', async () => {
	await using terminal = await launchTerminal(options);
	await terminal.screen.findByText('READY');
	const entered = gate<void>();
	const first = gate<string>();
	let ready = false;
	const waiting = terminal.waitFor(
		() => {
			entered.resolve();
			return ready ? Promise.resolve('recovered') : first.promise;
		},
		{ intervalMs: 5 },
	);
	await entered.promise;
	ready = true;
	first.reject(new Error('not ready yet'));
	expect(await waiting).toBe('recovered');
});

test('an already aborted signal prevents the first callback', async () => {
	await using terminal = await launchTerminal(options);
	const reason = new Error('already canceled');
	let called = false;
	await expect(
		terminal.waitFor(
			() => {
				called = true;
			},
			{ signal: AbortSignal.abort(reason) },
		),
	).rejects.toBe(reason);
	expect(called).toBe(false);
});

test('async rejection retries and timeout preserves the last assertion as its cause', async () => {
	await using terminal = await launchTerminal(options);
	await terminal.screen.findByText('READY');
	const failure = new Error('expected saved status');
	await expect(
		terminal.waitFor(
			async () => {
				throw failure;
			},
			{ timeoutMs: 20, intervalMs: 5 },
		),
	).rejects.toMatchObject({
		code: 'GW_WAIT_TIMEOUT',
		cause: failure,
		message: expect.stringContaining('READY'),
	});
	await expect(
		terminal.waitFor(() => new Promise(() => {}), { timeoutMs: 20 }),
	).rejects.toMatchObject({ code: 'GW_WAIT_TIMEOUT' });
});

test('external cancellation stops attempts without closing the terminal', async () => {
	await using terminal = await launchTerminal(options);
	await terminal.screen.findByText('READY');
	const controller = new AbortController();
	const entered = gate<void>();
	const reason = new Error('stop this wait');
	const waiting = terminal
		.waitFor(
			() => {
				entered.resolve();
				return new Promise(() => {});
			},
			{ signal: controller.signal },
		)
		.catch((error: unknown) => error);
	await entered.promise;
	controller.abort(reason);
	expect(await waiting).toBe(reason);
	expect(terminal.signal.aborted).toBe(false);
	await terminal.keyboard.type('c');
	expect((await terminal.screen.findByText('CHANGED')).text()).toBe('CHANGED');
});

test('scope disposal cancels pending waits and rejects escaped queries', async () => {
	const terminal = await launchTerminal(options);
	await terminal.screen.findByText('READY');
	const entered = gate<void>();
	const waiting = terminal
		.waitFor(() => {
			entered.resolve();
			return new Promise(() => {});
		})
		.catch((error: unknown) => error);
	await entered.promise;
	await terminal[Symbol.asyncDispose]();
	expect(await waiting).toBeInstanceOf(Error);
	expect(() => terminal.screen.getByText('READY')).toThrow();
	await expect(terminal.waitFor(() => true)).rejects.toBeInstanceOf(Error);
});

for (const value of [-1, Infinity, NaN, 2_147_483_648]) {
	test(`invalid wait durations fail before running the callback: ${value}`, async () => {
		await using terminal = await launchTerminal(options);
		let called = false;
		await expect(
			terminal.waitFor(
				() => {
					called = true;
				},
				{ timeoutMs: value },
			),
		).rejects.toMatchObject({ code: 'GW_INVALID_OPTIONS' });
		await expect(
			terminal.waitFor(
				() => {
					called = true;
				},
				{ intervalMs: value },
			),
		).rejects.toMatchObject({ code: 'GW_INVALID_OPTIONS' });
		expect(called).toBe(false);
	});
}

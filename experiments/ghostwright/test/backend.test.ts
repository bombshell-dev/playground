import { expect, test } from 'bun:test';
import { call, createContext, resource, run, suspend, type Operation } from 'effection';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
	GhostwrightError,
	createGhosttyBackend,
	launchTerminal,
	expectTerminal,
	replayTrace,
	type CreateBackend,
	type TerminalBackend,
} from '../src/index.ts';
import { normalizeViewport } from '../src/profile.ts';
import { createTerminal } from '../spikes/in-process.ts';
import { withTerminal as withOperationTerminal } from '../src/effection/index.ts';
import { TerminalOutput } from '../src/terminal/output.ts';
import type { Observation } from '../src/observations.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const options = { viewport: normalizeViewport({ columns: 20, rows: 4 }) };

test('scoped backends isolate state, return effects, and reject escaped use after release', async () => {
	let escaped!: TerminalBackend;
	await run(function* () {
		const first = (escaped = yield* createGhosttyBackend(options));
		const second = yield* createGhosttyBackend(options);
		const initial = first.snapshot();
		const update = first.write(bytes('hello\x1b[?2004h\x1b[6n'));
		expect(update.snapshot.lines[0]!.text).toContain('hello');
		expect(initial.lines[0]!.text).not.toContain('hello');
		expect(second.snapshot().lines[0]!.text).not.toContain('hello');
		expect(update.effects).toContainEqual({ type: 'write-pty', data: bytes('\x1b[1;6R') });
		expect(first.write(bytes('!')).effects).toEqual([]);
		expect(first.encodePaste('paste')).toEqual(bytes('\x1b[200~paste\x1b[201~'));
		expect(second.encodePaste('paste')).toEqual(bytes('paste'));
		expect(
			first.resize(normalizeViewport({ columns: 30, rows: 5 })).snapshot.viewport.columns,
		).toBe(30);
	});
	expect(() => escaped.snapshot()).toThrow('scope is closed');
	expect(() => escaped.write(bytes('late'))).toThrow('scope is closed');
	expect(() => escaped.encodeKey('Enter')).toThrow('scope is closed');
});

test('halting an operation releases its backend', async () => {
	const ready = Promise.withResolvers<TerminalBackend>();
	const task = run(function* () {
		const backend = yield* createGhosttyBackend(options);
		ready.resolve(backend);
		yield* suspend();
	});
	const backend = await ready.promise;
	await task.halt();
	expect(() => backend.snapshot()).toThrow('scope is closed');
});

test('backend updates preserve semantic boundaries within one input chunk', async () => {
	await run(function* () {
		const backend = yield* createGhosttyBackend(options);
		let current = backend.snapshot();
		const observations: Observation[] = [];
		const output = new TerminalOutput(
			[
				{
					id: 'semantic',
					osc: {
						number: 7777,
						namespace: 'test',
						maxBufferedBytes: 1024,
						decode: () => ({ protocolFrame: 1, value: { selector: '#save' } }),
					},
				},
			],
			() => current,
			(data) => (current = backend.write(data).snapshot),
		);
		output.observations.subscribe((observation) => observations.push(observation));
		output.push(bytes('before\x1b]7777;test;v=1;payload\x1b\\\r\x1b[2Kafter'));
		expect(observations.map((observation) => observation.kind)).toEqual([
			'screen',
			'extension',
			'screen',
		]);
		expect(observations[1]!.screen.lines[0]!.text).toContain('before');
		expect(current.lines[0]!.text).toContain('after');
		expect(output.observations.current('semantic')).toBeUndefined();
	});
});

test('PTY actions use the supplied backend and replay requires its identity', async () => {
	const directory = await mkdtemp(`${tmpdir()}/ghostwright-backend-`);
	let released = 0;
	let writes = 0;
	const backend: CreateBackend = (settings) =>
		resource(function* (provide) {
			const ghostty = yield* createGhosttyBackend(settings);
			try {
				yield* provide({
					...ghostty,
					identity: { name: 'test-keymap', version: '1' },
					write(data) {
						writes++;
						return ghostty.write(data);
					},
					encodeKey(key) {
						return ghostty.encodeKey(
							typeof key === 'string'
								? key === 'x'
									? 'y'
									: key
								: { ...key, key: key.key === 'x' ? 'y' : key.key },
						);
					},
				});
			} finally {
				released++;
			}
		});
	try {
		const terminal = await launchTerminal({
			command: process.execPath,
			args: [
				'-e',
				'process.stdin.setRawMode(true); process.stdin.on("data", b => { process.stdout.write("GOT:" + b); process.exit(0); }); process.stdout.write("READY");',
			],
			backend,
			trace: { policy: 'on', directory },
		});
		try {
			await expectTerminal(terminal.getByText('READY')).toBePresent();
			await terminal.keyboard.press('x');
			await expectTerminal(terminal.getByText('GOT:y')).toBePresent();
			expect((await terminal.process.waitForExit()).exitCode).toBe(0);
		} finally {
			await terminal.close();
		}
		expect(writes).toBeGreaterThan(0);
		expect(released).toBe(1);
		const trace = `${directory}/${(await readdir(directory))[0]}`;
		await expect(replayTrace(trace)).rejects.toThrow('Trace backend is incompatible');
		const replay = await replayTrace(trace, { backend });
		expect(replay.finalSnapshot.lines.map((line) => line.text).join('\n')).toContain('GOT:y');
		expect(released).toBe(2);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('local component sessions use the factory for output and resize and await cleanup', async () => {
	let writes = 0,
		resizes = 0,
		released = false;
	let acquired!: TerminalBackend;
	const backend: CreateBackend = (settings) =>
		resource(function* (provide) {
			const ghostty = (acquired = yield* createGhosttyBackend(settings));
			try {
				yield* provide({
					...ghostty,
					write(data) {
						writes++;
						return ghostty.write(data);
					},
					resize(viewport) {
						resizes++;
						return ghostty.resize(viewport);
					},
				});
			} finally {
				yield* call(() => Promise.resolve());
				released = true;
			}
		});
	const terminal = await createTerminal({ backend });
	try {
		terminal.stdout.write('local');
		expect(terminal.screen.getText()).toContain('local');
		await terminal.resize({ columns: 30, rows: 5 });
		expect(terminal.screen.current().viewport.columns).toBe(30);
	} finally {
		await terminal[Symbol.asyncDispose]();
	}
	expect(writes).toBe(1);
	expect(resizes).toBe(1);
	expect(released).toBe(true);
	expect(() => acquired.snapshot()).toThrow('scope is closed');
});

test('failed process launch and failed extension setup release the acquired backend', async () => {
	let released = 0;
	const backend: CreateBackend = (settings) =>
		resource(function* (provide) {
			const ghostty = yield* createGhosttyBackend(settings);
			try {
				yield* provide(ghostty);
			} finally {
				released++;
			}
		});
	await expect(
		launchTerminal({ command: '/definitely/missing', backend, trace: 'off' }),
	).rejects.toMatchObject({ code: 'GW_LAUNCH' });
	expect(released).toBe(1);
	await expect(
		launchTerminal({
			command: process.execPath,
			backend,
			trace: 'off',
			extensions: [
				{
					id: 'broken',
					setup() {
						throw new GhostwrightError({ code: 'TEST_SETUP', message: 'broken setup' });
					},
				},
			],
		}),
	).rejects.toThrow('broken setup');
	expect(released).toBe(2);
});

test('failed backend acquisition releases resources before rejecting launch', async () => {
	let acquired!: TerminalBackend;
	const backend: CreateBackend = function* (settings): Operation<TerminalBackend> {
		acquired = yield* createGhosttyBackend(settings);
		throw new GhostwrightError({ code: 'TEST_BACKEND', message: 'backend unavailable' });
	};
	await expect(
		launchTerminal({ command: process.execPath, backend, trace: 'off' }),
	).rejects.toThrow('backend unavailable');
	expect(() => acquired.snapshot()).toThrow('scope is closed');
});

test('session backend factories inherit Effection context and outlive process drain', async () => {
	const context = createContext<string>('backend-test-context');
	let acquired!: TerminalBackend;
	let cleanupScreen = '';
	const backend: CreateBackend = function* (settings) {
		expect(yield* context.expect()).toBe('scoped');
		return (acquired = yield* createGhosttyBackend(settings));
	};
	await run(function* () {
		yield* context.set('scoped');
		yield* withOperationTerminal(
			{
				command: process.execPath,
				args: [
					'-e',
					'process.stdin.setRawMode(true); process.stdin.resume(); process.on("SIGTERM", () => { process.stdout.write("DRAINED"); process.exit(0); }); process.stdout.write("READY");',
				],
				backend,
				trace: 'off',
				extensions: [
					{
						id: 'drain',
						setup(observe) {
							return () => {
								cleanupScreen = observe
									.current()
									.lines.map((line) => line.text)
									.join('\n');
							};
						},
					},
				],
			},
			function* (terminal) {
				yield* terminal.screen.findByText('READY');
				yield* terminal.process.signal('SIGTERM');
				yield* terminal.process.waitForExit();
			},
		);
	});
	expect(cleanupScreen).toContain('DRAINED');
	expect(() => acquired.snapshot()).toThrow('scope is closed');
});

test('cancelling during acquisition still closes a late backend and process', async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let acquired!: TerminalBackend;
	let released = false;
	let bodyEntered = false;
	const backend: CreateBackend = (settings) =>
		resource(function* (provide) {
			acquired = yield* createGhosttyBackend(settings);
			try {
				entered.resolve();
				yield* call(() => release.promise);
				yield* provide(acquired);
			} finally {
				released = true;
			}
		});
	const task = run(function* () {
		yield* withOperationTerminal(
			{ command: '/bin/sh', args: ['-c', 'sleep 30'], backend, trace: 'off' },
			function* () {
				bodyEntered = true;
				yield* suspend();
			},
		);
	});
	await entered.promise;
	const stopping = task.halt().then(() => {});
	release.resolve();
	await stopping;
	expect(bodyEntered).toBe(false);
	expect(released).toBe(true);
	expect(() => acquired.snapshot()).toThrow('scope is closed');
});

test('a backend cleanup failure still closes extensions and surfaces the failure', async () => {
	let extensionClosed = false;
	const backend: CreateBackend = (settings) =>
		resource(function* (provide) {
			const ghostty = yield* createGhosttyBackend(settings);
			try {
				yield* provide(ghostty);
			} finally {
				// oxlint-disable-next-line no-unsafe-finally -- Exercise a failing resource finalizer.
				throw new GhostwrightError({ code: 'TEST_CLEANUP', message: 'backend cleanup failed' });
			}
		});
	const terminal = await launchTerminal({
		command: '/bin/sh',
		args: ['-c', 'printf READY; sleep 30'],
		backend,
		trace: 'off',
		extensions: [
			{
				id: 'cleanup',
				setup() {
					return () => {
						extensionClosed = true;
					};
				},
			},
		],
	});
	await expectTerminal(terminal.getByText('READY')).toBePresent();
	await expect(terminal.close()).rejects.toThrow();
	expect(extensionClosed).toBe(true);
	expect(() => process.kill(terminal.process.status().pid!, 0)).toThrow();
});

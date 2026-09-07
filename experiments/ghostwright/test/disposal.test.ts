import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { launchTerminal, expectTerminal, regionLocator, textContains } from '../src/index.ts';

const options = {
	command: process.execPath,
	args: [
		'-e',
		'process.stdin.setRawMode(true); process.stdin.resume(); process.stdout.write("READY")',
	],
	trace: 'off' as const,
};

test('await using owns pending work, the child process, and escaped handles', async () => {
	const terminal = await launchTerminal(options);
	await expectTerminal(terminal.getByText('READY')).toBePresent();
	const pending = terminal
		.capture(
			{
				until: regionLocator({ column: 0, row: 0, width: 10, height: 1 }).satisfies(
					textContains('never'),
				),
			},
			async () => {},
		)
		.catch((error: unknown) => error);
	{
		await using owned = terminal;
		expect(owned.signal.aborted).toBe(false);
	}
	expect(await pending).toBeInstanceOf(Error);
	expect(terminal.signal.aborted).toBe(true);
	expect(terminal.process.status().state).toBe('closed');
	expect(() => process.kill(terminal.process.status().pid!, 0)).toThrow();
	await expect(terminal.keyboard.type('late')).rejects.toBeInstanceOf(Error);
	await terminal[Symbol.asyncDispose]();
	await terminal.close();
});

test('an abort listener can reenter disposal without persisting the trace twice', async () => {
	const directory = await mkdtemp(`${tmpdir()}/ghostwright-dispose-`);
	const terminal = await launchTerminal({ ...options, trace: { policy: 'on', directory } });
	let reentered: Promise<void> | undefined;
	terminal.signal.addEventListener('abort', () => {
		reentered = terminal[Symbol.asyncDispose]();
	});
	await terminal[Symbol.asyncDispose]();
	await reentered;
	expect(await readdir(directory)).toHaveLength(1);
	await rm(directory, { recursive: true, force: true });
});

test('an assertion failure still disposes an await-using terminal', async () => {
	let terminal: Awaited<ReturnType<typeof launchTerminal>> | undefined;
	const failure = new Error('test body failed');
	await expect(
		(async () => {
			await using owned = await launchTerminal(options);
			terminal = owned;
			await expectTerminal(owned.getByText('READY')).toBePresent();
			throw failure;
		})(),
	).rejects.toBe(failure);
	expect(terminal!.signal.aborted).toBe(true);
	expect(terminal!.process.status().state).toBe('closed');
});

test('failed acquisition releases its scope and does not poison another terminal', async () => {
	await expect(
		launchTerminal({ command: '/definitely/missing', trace: 'off' }),
	).rejects.toMatchObject({ code: 'GW_LAUNCH' });
	await using terminal = await launchTerminal(options);
	await expectTerminal(terminal.getByText('READY')).toBePresent();
});

test('disposal overtakes a blocked write and awaits process cleanup', async () => {
	await using terminal = await launchTerminal({
		...options,
		args: [
			'-e',
			String.raw`
			process.stdin.setRawMode(true);
			process.stdin.once('data', () => {
				process.stdin.pause();
				process.stdout.write('\r\nPAUSED');
			});
			process.stdout.write('READY');
			setInterval(() => {}, 1000);
			`,
		],
	});
	await expectTerminal(terminal.getByText('READY')).toBePresent();
	const writing = terminal.keyboard
		.write(new Uint8Array(4 * 1024 * 1024).fill(120))
		.catch((error: unknown) => error);
	// The child has received input and stopped reading. The remaining payload
	// cannot fit in the PTY queue; disposal must interrupt real pending I/O.
	await terminal.screen.findByText('PAUSED');
	await terminal[Symbol.asyncDispose]();
	expect(await writing).toBeInstanceOf(Error);
	expect(terminal.process.status().state).toBe('closed');
});

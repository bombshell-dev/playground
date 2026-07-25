import { expect, test } from 'bun:test';
import { expectTerminal, withTerminalAsync } from '../src';
test('launches under a real PTY and snapshots output', async () => {
	await withTerminalAsync(
		{
			command: '/bin/sh',
			args: ['-c', `test -t 0 && test -t 1 && test -t 2 && printf 'TTY READY'`],
			trace: 'off',
		},
		async (terminal) => {
			const match = await expectTerminal(terminal.getByText('TTY READY')).toBePresent();
			expect(match.range).toEqual({ column: 0, row: 0, width: 9, height: 1 });
			const status = await terminal.process.waitForExit();
			expect(status.exitCode).toBe(0);
			expect(status.ptyEof).toBe(true);
		},
	);
});
test('resizes the kernel PTY without synthetic input', async () => {
	await withTerminalAsync(
		{
			command: '/bin/sh',
			args: ['-c', `trap 'stty size; exit' WINCH; printf READY; while :; do sleep 1; done`],
			trace: 'off',
		},
		async (terminal) => {
			await expectTerminal(terminal.getByText('READY')).toBePresent();
			await terminal.resize({ columns: 43, rows: 12 });
			await expectTerminal(terminal.getByText('12 43')).toBePresent({ timeoutMs: 2000 });
		},
	);
});

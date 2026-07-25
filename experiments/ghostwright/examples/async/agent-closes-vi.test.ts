import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
// oxlint-disable-next-line no-restricted-imports -- path module needed for path resolution
import { join } from 'node:path';
import { expectTerminal, withTerminalAsync } from '../../src/index.ts';

test('a coding agent can successfully close vi', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'ghostwright-vi-')),
		fixture = join(directory, 'agent-test.txt');
	await writeFile(fixture, 'GHOSTWRIGHT_VI_MARKER\n');

	try {
		await withTerminalAsync(
			{
				command: 'vi',
				args: [fixture],
				env: { HOME: directory, EXINIT: '', VIMINIT: '' },
				viewport: { columns: 80, rows: 24 },
				trace: 'off',
			},
			async (terminal) => {
				await expectTerminal(terminal.getByText('GHOSTWRIGHT_VI_MARKER')).toBePresent({
					timeoutMs: 5_000,
				});

				await terminal.keyboard.press('Escape');
				await terminal.keyboard.type(':q!');
				await terminal.keyboard.press('Enter');

				const status = await terminal.process.waitForExit({ timeoutMs: 5_000 });
				expect(status.exitCode).toBe(0);
				expect(status.ptyEof).toBe(true);
			},
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

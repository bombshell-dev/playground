import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from 'effection';
import { expectTerminal, withTerminal } from '../../src/index.ts';

test('interactive bash restores its screen after vi exits with Effection', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'ghostwright-bash-vi-')),
		fixture = join(directory, 'agent-test.txt');
	await writeFile(fixture, 'GHOSTWRIGHT_VI_MARKER\n');

	try {
		await run(function* () {
			return yield* withTerminal(
				{
					command: 'bash',
					args: ['--noprofile', '--norc', '-i'],
					env: {
						HOME: directory,
						PS1: 'GHOSTWRIGHT_PROMPT> ',
						PS2: 'GHOSTWRIGHT_CONTINUE> ',
						PROMPT_COMMAND: '',
						EXINIT: '',
						VIMINIT: '',
					},
					viewport: { columns: 80, rows: 24 },
					trace: 'off',
				},
				function* (terminal) {
					yield* expectTerminal(terminal).toSatisfy(
						(snapshot) => snapshot.lines.some((line) => line.text.includes('GHOSTWRIGHT_PROMPT> ')),
						{ timeoutMs: 5_000, settleMs: 100 },
					);

					yield* terminal.keyboard.type('echo hello world');
					yield* terminal.keyboard.press('Enter');
					yield* expectTerminal(terminal).toSatisfy(
						(snapshot) => snapshot.lines.some((line) => line.text.trim() === 'hello world'),
						{ timeoutMs: 5_000, settleMs: 100 },
					);

					yield* terminal.keyboard.type(`vi ${fixture}`);
					yield* terminal.keyboard.press('Enter');
					yield* expectTerminal(terminal.getByText('GHOSTWRIGHT_VI_MARKER')).toBePresent({
						timeoutMs: 5_000,
					});
					expect(terminal.screen.current().activeBuffer).toBe('alternate');

					yield* terminal.keyboard.press('Escape');
					yield* terminal.keyboard.type(':q!');
					yield* terminal.keyboard.press('Enter');

					yield* expectTerminal(terminal).toSatisfy(
						(snapshot) => snapshot.lines.some((line) => line.text.includes('GHOSTWRIGHT_PROMPT> ')),
						{ timeoutMs: 5_000, settleMs: 100 },
					);
					expect(terminal.screen.current().activeBuffer).toBe('primary');
					yield* expectTerminal(terminal).toSatisfy(
						(snapshot) => snapshot.lines.some((line) => line.text.trim() === 'hello world'),
						{ timeoutMs: 5_000, settleMs: 100 },
					);

					yield* terminal.keyboard.type('exit');
					yield* terminal.keyboard.press('Enter');
					const status = yield* terminal.process.waitForExit({ timeoutMs: 5_000 });
					expect(status.exitCode).toBe(0);
					expect(status.ptyEof).toBe(true);
				},
			);
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

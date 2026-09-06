import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
// oxlint-disable-next-line no-restricted-imports -- temporary fixture paths
import { join } from 'node:path';
import { withTerminalAsync, type AsyncExecution, type Viewport } from '../../src/index.ts';
import { netrw } from './netrw.ts';

for (const viewport of [
	{ columns: 80, rows: 24 },
	{ columns: 100, rows: 36 },
]) {
	test(`open a file from Vim's explorer at ${viewport.columns}×${viewport.rows}`, async () => {
		await withVim(viewport, async (ui) => {
			const explorer = netrw(ui);
			const readme = explorer.find('README.md');

			// Recognize the explorer, then find a file inside it. The other window
			// also says "README.md", but it is not an explorer entry.
			await ui.expect(explorer.region).toContainText('Netrw Directory Listing');
			await ui.expect(readme.region).toContainText('README.md');

			// The adapter navigates with normal-mode keys and presses Enter.
			// It does not ask Vim for a buffer, filename, or window coordinate.
			await readme.open();
			await ui.expect(readme.editor).toContainText('# Opened through the explorer');
			await ui.expect(readme.editor).toContainText('This text came from README.md.');
			await ui.expect(readme.editor).toContainCursor({ visible: true });

			await ui.keyboard.type(':qa!');
			await ui.keyboard.press('Enter');
			expect((await ui.process.waitForExit()).exitCode).toBe(0);
		});
	});
}

test('open an earlier file after moving to the end of the listing', async () => {
	await withVim({ columns: 80, rows: 24 }, async (ui) => {
		const explorer = netrw(ui);
		await ui.expect(explorer.region).toContainCursor({ visible: true });
		await ui.keyboard.type('G');
		await ui.expect(explorer.find('WELCOME.txt').region).toContainCursor({ visible: true });
		const readme = explorer.find('README.md');
		await readme.open();
		await ui.expect(readme.editor).toContainText('# Opened through the explorer');
	});
});

test('refuse to navigate when the cursor belongs to the neighboring editor', async () => {
	await withVim({ columns: 80, rows: 24 }, async (ui) => {
		const explorer = netrw(ui);
		await ui.expect(explorer.region).toContainCursor({ visible: true });
		await ui.keyboard.press({ key: 'w', control: true });
		await ui.keyboard.type('l');
		await ui.expect(explorer.region).toSatisfy((region) => ({
			pass: region.screen.cursor.visible && !region.cursor().inside,
			expected: 'cursor in the neighboring window',
			actual: region.cursor(),
		}));
		await expect(explorer.find('README.md').open()).rejects.toMatchObject({ code: 'GW_VIM_FOCUS' });
	});
});

/** A real, isolated Vim with its bundled netrw. No application instrumentation. */
async function withVim(viewport: Viewport, body: (ui: AsyncExecution) => Promise<void>) {
	const directory = await mkdtemp(join(tmpdir(), 'ghostwright-netrw-'));
	try {
		await writeFile(
			join(directory, 'README.md'),
			'# Opened through the explorer\nThis text came from README.md.\n',
		);
		await writeFile(
			join(directory, 'WELCOME.txt'),
			'README.md\nThis is a decoy in the neighboring editor.\n',
		);
		await withTerminalAsync(
			{
				command: process.env.GHOSTWRIGHT_VIM ?? 'vim',
				args: [
					'-Nu',
					'NONE',
					'-i',
					'NONE',
					'-n',
					'-R',
					'--cmd',
					'set nocompatible',
					'--cmd',
					'set runtimepath=$VIMRUNTIME packpath=$VIMRUNTIME',
					'-c',
					'let g:netrw_dirhistmax=0 | let g:netrw_liststyle=0 | let g:netrw_winsize=45',
					'-c',
					'runtime plugin/netrwPlugin.vim',
					'-c',
					'set laststatus=2',
					'-c',
					'Vexplore .',
					'WELCOME.txt',
				],
				cwd: directory,
				env: { HOME: directory, EXINIT: '', VIMINIT: '', LC_ALL: 'C' },
				viewport,
				trace: 'off',
			},
			body,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

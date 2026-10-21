import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { withTerminal } from 'ghostwright';
import { recordingExtension } from 'ghostwright/recording';
import { netrw } from './netrw.ts';

/** Drive the same visible Vim editing journey in local and packaged CI tests. */
export async function vimNormalSkills() {
	const directory = await mkdtemp(`${tmpdir()}/vim-skills-`);
	const output = process.env.GHOSTWRIGHT_RECORD_DIR ?? '.ghostwright/recordings';
	const recording = recordingExtension({
		output: `${output}/vim-normal-skills`,
		formats: ['gif', 'mp4'],
		stepMs: 850,
	});
	try {
		await writeFile(
			`${directory}/refactor.ts`,
			[
				'// NORMAL MODE: small motions, big edits',
				'const title = "draft";',
				'const label = "draft";',
				'const squad = "alpha";',
				'const score = 41;',
				'',
				'// ci" -> . -> gUiw -> yyp -> Ctrl-A -> u -> Ctrl-R',
				'',
			].join('\n'),
		);
		await writeFile(
			`${directory}/WELCOME.txt`,
			'VIM NORMAL-MODE LAB\n\nOpen netrw with :Vexplore .\nChoose refactor.ts and make it shine.\n',
		);
		await withTerminal(
			{
				command: process.env.GHOSTWRIGHT_VIM ?? 'vim',
				args: [
					'-Nu',
					'NONE',
					'-i',
					'NONE',
					'-n',
					'--cmd',
					'set nocompatible',
					'--cmd',
					'set runtimepath=$VIMRUNTIME packpath=$VIMRUNTIME',
					'-c',
					'let g:netrw_dirhistmax=0 | let g:netrw_liststyle=0 | let g:netrw_winsize=48',
					'-c',
					'runtime plugin/netrwPlugin.vim',
					'-c',
					'filetype on | syntax enable | set background=dark',
					'-c',
					'set laststatus=2 noshowmode noruler mouse=a ttymouse=sgr',
					'WELCOME.txt',
				],
				cwd: directory,
				env: { HOME: directory, EXINIT: '', VIMINIT: '', LC_ALL: 'C' },
				viewport: { columns: 120, rows: 26 },
				extensions: [recording],
				trace: 'retain-on-failure',
			},
			async (ui) => {
				using _capture = recording;
				await ui.screen.findByText('VIM NORMAL-MODE LAB');
				await ui.keyboard.type(':Vexplore .');
				await ui.keyboard.press('Enter');
				const explorer = netrw(ui);
				await ui.expect(explorer.region).toContainText('Netrw Directory Listing');
				const file = explorer.find('refactor.ts');
				await file.open();
				await ui.expect(file.editor).toContainText('const title = "draft";');
				// A text object replaces only the quoted content, keeping its delimiters.
				await ui.keyboard.type('gg2j0');
				await ui.keyboard.type('ci"LIVE');
				await ui.keyboard.press('Escape');
				await ui.expect(file.editor).toContainText('const label = "LIVE";');
				// Repeat the previous change on the other quoted string.
				await ui.keyboard.type('k0.');
				await ui.expect(file.editor).toContainText('const title = "LIVE";');
				// Operator + motion: uppercase the word under the cursor.
				await ui.keyboard.type('2j0f"l');
				await ui.keyboard.type('gUiw');
				await ui.expect(file.editor).toContainText('const squad = "ALPHA";');
				// Yank and put a complete line, then change the copy with a text object.
				await ui.keyboard.type('yyp');
				await ui.keyboard.type('0ciwlet');
				await ui.keyboard.press('Escape');
				await ui.expect(file.editor).toContainText('let squad = "ALPHA";');
				await ui.keyboard.type('j0f4');
				await ui.keyboard.press({ key: 'a', control: true });
				await ui.expect(file.editor).toContainText('const score = 42;');
				await ui.keyboard.type('u');
				await ui.expect(file.editor).toContainText('const score = 41;');
				await ui.keyboard.press({ key: 'r', control: true });
				await ui.expect(file.editor).toContainText('const score = 42;');
				await ui.keyboard.type(':w');
				await ui.keyboard.press('Enter');
				await ui.screen.findByText('written');
				recording.stop();
				await ui.keyboard.type(':qa!');
				await ui.keyboard.press('Enter');
				assert.equal((await ui.process.waitForExit()).exitCode, 0);
			},
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

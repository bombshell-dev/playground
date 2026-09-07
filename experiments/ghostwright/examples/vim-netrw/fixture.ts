import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
// oxlint-disable-next-line no-restricted-imports -- temporary fixture paths
import { join } from 'node:path';
import {
	withTerminal,
	type AsyncExecution,
	type TerminalLaunchOptions,
	type Viewport,
} from '../../src/index.ts';

/** A real, isolated Vim with its bundled netrw. No application instrumentation. */
export async function withVim<T>(
	options: { viewport: Viewport; trace?: TerminalLaunchOptions['trace'] },
	body: (ui: AsyncExecution) => Promise<T>,
): Promise<T> {
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
		return await withTerminal(
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
					'set laststatus=2 mouse=a ttymouse=sgr',
					'-c',
					'Vexplore .',
					'WELCOME.txt',
				],
				cwd: directory,
				env: { HOME: directory, EXINIT: '', VIMINIT: '', LC_ALL: 'C' },
				viewport: options.viewport,
				trace: options.trace ?? 'retain-on-failure',
			},
			body,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { prepareWorkspace } from './dev-repos.mjs';

test('pnpm resolves one live UI and TTY across separate repos without editing their manifests', async () => {
	const temporary = await mkdtemp(`${tmpdir()}/bombshell-dev-repos-`);
	try {
		const playground = `${temporary}/playground`;
		const ui = `${temporary}/ui`;
		const tty = `${temporary}/tty`;
		const files = new Map([
			[
				`${playground}/package.json`,
				{
					name: 'playground-fixture',
					private: true,
					dependencies: { '@clack/ui': 'workspace:*', '@bomb.sh/tty': '^0.8.0' },
				},
			],
			[`${ui}/package.json`, { name: 'ui-workspace-fixture', private: true }],
			[
				`${ui}/packages/ui/package.json`,
				{ name: '@clack/ui', version: '0.0.0', dependencies: { '@bomb.sh/tty': 'catalog:' } },
			],
			[
				`${ui}/packages/ui-preact/package.json`,
				{
					name: '@clack/ui-preact',
					version: '0.0.0',
					dependencies: { '@clack/ui': 'workspace:*' },
				},
			],
			[`${tty}/package.json`, { name: '@bomb.sh/tty', version: '0.9.0', private: true }],
			[`${tty}/build/npm/package.json`, { name: '@bomb.sh/tty', version: '0.9.0' }],
			// A vendored provider with the same name must not enter the package graph.
			[`${playground}/vendor/clack-ui/package.json`, { name: '@clack/ui', version: '0.0.0' }],
		]);
		for (const [path, value] of files) {
			await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
			await writeFile(path, JSON.stringify(value));
		}
		for (const source of [playground, ui, tty]) {
			const init = spawnSync('git', ['init', '--initial-branch=development', source], {
				encoding: 'utf8',
			});
			assert.equal(init.status, 0, init.stderr);
			const commit = spawnSync(
				'git',
				[
					'-C',
					source,
					'-c',
					'user.name=Fixture',
					'-c',
					'user.email=fixture@example.test',
					'commit',
					'--allow-empty',
					'-m',
					'fixture',
				],
				{ encoding: 'utf8' },
			);
			assert.equal(commit.status, 0, commit.stderr);
		}
		await writeFile(
			`${playground}/pnpm-workspace.yaml`,
			'packages: ["vendor/*"]\ncatalog: {"@bomb.sh/tty": "^0.8.0"}\n',
		);
		await writeFile(
			`${ui}/pnpm-workspace.yaml`,
			'packages: ["packages/*"]\ncatalog: {"@bomb.sh/tty": "^0.7.0"}\n',
		);
		const result = await prepareWorkspace({ playground, ui, tty });
		assert.deepEqual(result.ready, { uiPreact: true, ttyPackage: true });
		assert.equal(result.sources.find((source) => source.name === 'ui').branch, 'development');
		const installed = spawnSync(
			'pnpm',
			['--dir', result.output, 'install', '--ignore-scripts', '--offline'],
			{ encoding: 'utf8', timeout: 30_000 },
		);
		assert.equal(installed.status, 0, installed.stdout + installed.stderr);
		assert.equal(await realpath(`${playground}/node_modules/@clack/ui`), `${ui}/packages/ui`);
		assert.equal(await realpath(`${playground}/node_modules/@bomb.sh/tty`), `${tty}/build/npm`);
		assert.equal(await realpath(`${ui}/packages/ui/node_modules/@bomb.sh/tty`), `${tty}/build/npm`);
		assert.equal(
			await realpath(`${ui}/packages/ui-preact/node_modules/@clack/ui`),
			`${ui}/packages/ui`,
		);
		for (const [path, value] of files)
			assert.equal(await readFile(path, 'utf8'), JSON.stringify(value));
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

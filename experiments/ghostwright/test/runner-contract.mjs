import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const runners = [
	['Vitest', ['run', 'test:vitest']],
	['Jest', ['run', 'test:jest']],
];
for (const [name, args] of runners) {
	for (const negative of [false, true]) {
		const directory = await mkdtemp(`${tmpdir()}/ghostwright-runner-`);
		const result = spawnSync('pnpm', args, {
			cwd,
			encoding: 'utf8',
			timeout: 30_000,
			env: {
				...process.env,
				NODE_OPTIONS: '--experimental-vm-modules',
				GHOSTWRIGHT_NEGATIVE: negative ? '1' : '',
				GHOSTWRIGHT_TRACES: directory,
				GHOSTWRIGHT_CLEANUP_REPORT: `${directory}.cleanup.json`,
			},
		});
		const output = result.stdout + result.stderr;
		assert.equal(result.status, negative ? 1 : 0, `${name}: ${output}`);
		if (name === 'Vitest') {
			const cleanup = JSON.parse(await readFile(`${directory}.cleanup.json`, 'utf8'));
			assert.equal(cleanup.closed, negative ? 3 : 1, output);
			await rm(`${directory}.cleanup.json`);
		}
		const artifacts = await readdir(directory);
		assert.equal(artifacts.length, negative ? 1 : 0, `${name}: artifacts ${artifacts}; ${output}`);
		if (negative) {
			assert.match(output, /Expected text containing/);
			assert.match(output, /actual terminal text/);
			const failure = await readFile(`${directory}/${artifacts[0]}/failure.txt`, 'utf8');
			assert.match(failure, /expected terminal text/);
		}
		await rm(directory, { recursive: true, force: true });
	}
	console.info(`${name} integration: positive assertions and failure artifacts passed`);
}

import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, realpath, access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parse, stringify } from 'yaml';

/** Generate a pnpm workspace over independent checkouts without rewriting their manifests. */
export async function prepareWorkspace(options) {
	const playground = await realpath(options.playground);
	const ui = await realpath(options.ui);
	const tty = await realpath(options.tty);
	const output =
		options.output ?? fileURLToPath(new URL('.dev/workspace/', pathToFileURL(`${playground}/`)));
	const config = await workspaceConfig(playground);
	const uiConfig = await workspaceConfig(ui);
	const playgroundPackage = await json(`${playground}/package.json`);
	const uiWorkspacePackage = await json(`${ui}/package.json`);
	const uiPackage = await json(`${ui}/packages/ui/package.json`);
	const ttyPackage = await json(`${tty}/package.json`);
	if (uiPackage.name !== '@clack/ui' || ttyPackage.name !== '@bomb.sh/tty') {
		throw new DevelopmentWorkspaceError('Expected UI and TTY repository roots');
	}
	// The old UI packages are intentionally omitted: pnpm must see one provider
	// for each real package name. vendor/ui is a separate, older example package.
	const packages = [
		playground,
		`${playground}/packages/*`,
		`${playground}/experiments/*`,
		`${playground}/examples/*`,
		`${playground}/vendor/ui`,
		ui,
		`${ui}/packages/*`,
		`${tty}/build/npm`,
	];
	const patches = Object.fromEntries(
		Object.entries(uiConfig.patchedDependencies ?? {}).map(([name, value]) => [
			name,
			typeof value === 'string' ? `${ui}/${value}` : { ...value, path: `${ui}/${value.path}` },
		]),
	);
	const workspace = {
		packages,
		catalog: {
			...uiConfig.catalog,
			...config.catalog,
			'@clack/ui': 'workspace:*',
			'@bomb.sh/tty': 'workspace:*',
		},
		catalogs: { ...uiConfig.catalogs, ...config.catalogs },
		overrides: {
			'@clack/ui': 'workspace:*',
			'@clack/ui-preact': 'workspace:*',
			'@bomb.sh/tty': 'workspace:*',
		},
		patchedDependencies: patches,
		publicHoistPattern: [
			...new Set([...(config.publicHoistPattern ?? []), ...(uiConfig.publicHoistPattern ?? [])]),
		],
	};
	const sources = await Promise.all(
		[
			['playground', playground],
			['ui', ui],
			['tty', tty],
		].map(async ([name, path]) => ({
			name,
			path,
			branch: git(path, ['branch', '--show-current']),
			commit: git(path, ['rev-parse', 'HEAD']),
			dirty: git(path, ['status', '--porcelain']).length > 0,
		})),
	);
	await mkdir(output, { recursive: true });
	await writeFile(
		`${output}/package.json`,
		JSON.stringify(
			{
				name: '@bomb.sh/local-development',
				private: true,
				// pnpm adds the composed root's .bin to scripts, rather than the
				// independent source workspace roots. Provide their shared tooling here.
				devDependencies: {
					...uiWorkspacePackage.devDependencies,
					...playgroundPackage.devDependencies,
				},
			},
			null,
			2,
		) + '\n',
	);
	await writeFile(`${output}/pnpm-workspace.yaml`, stringify(workspace));
	await writeFile(`${output}/sources.json`, JSON.stringify(sources, null, 2) + '\n');
	const ready = {
		uiPreact: await exists(`${ui}/packages/ui-preact/package.json`),
		ttyPackage: await exists(`${tty}/build/npm/package.json`),
	};
	return { output, sources, ready };
}

class DevelopmentWorkspaceError extends Error {}

async function json(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}
async function workspaceConfig(path) {
	return parse(await readFile(`${path}/pnpm-workspace.yaml`, 'utf8'));
}
async function exists(path) {
	try {
		await access(path);
		return true;
	} catch (error) {
		if (error.code === 'ENOENT') return false;
		throw error;
	}
}
function git(cwd, args) {
	const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new DevelopmentWorkspaceError(result.stderr.trim());
	return result.stdout.trim();
}

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: { ui: { type: 'string' }, tty: { type: 'string' }, help: { type: 'boolean' } },
	});
	const command = positionals[0] ?? 'prepare';
	if (values.help) {
		process.stdout.write(
			'Usage: pnpm dev:repos [prepare|install|status] [--ui /checkout/ui] [--tty /checkout/tty]\n',
		);
		return;
	}
	if (!['prepare', 'install', 'status'].includes(command) || positionals.length > 1) {
		throw new DevelopmentWorkspaceError('Expected prepare, install, or status');
	}
	const playground = fileURLToPath(new URL('../', import.meta.url));
	const selection = `${playground}/.dev/workspace/sources.json`;
	const previous = (await exists(selection)) ? await json(selection) : [];
	const result = await prepareWorkspace({
		playground,
		ui:
			values.ui ??
			previous.find((source) => source.name === 'ui')?.path ??
			fileURLToPath(new URL('../../ui/', import.meta.url)),
		tty:
			values.tty ??
			previous.find((source) => source.name === 'tty')?.path ??
			fileURLToPath(new URL('../../tty/', import.meta.url)),
	});
	for (const source of result.sources) {
		process.stdout.write(
			`${source.name}: ${source.branch || '(detached)'} @ ${source.commit.slice(0, 12)}${source.dirty ? ' (local changes)' : ''}\n`,
		);
	}
	process.stdout.write(`Workspace: ${result.output}\n`);
	if (!result.ready.uiPreact)
		process.stdout.write(
			'Needs a UI branch containing packages/ui-preact (for example dom-preact).\n',
		);
	if (!result.ready.ttyPackage)
		process.stdout.write(
			'Needs TTY build/npm: build its WASM, then run deno task build:npm <version> in the TTY checkout.\n',
		);
	if (command === 'install') {
		if (!result.ready.uiPreact || !result.ready.ttyPackage) {
			throw new DevelopmentWorkspaceError(
				'Build/select the missing packages before installing the composed workspace',
			);
		}
		const child = spawnSync('pnpm', ['--dir', result.output, 'install', '--ignore-scripts'], {
			stdio: 'inherit',
		});
		if (child.error) throw child.error;
		if (child.status !== 0)
			throw new DevelopmentWorkspaceError(`pnpm install exited with ${child.status}`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	});
}

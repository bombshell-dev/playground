import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from '@bomb.sh/args';
import { select, isCancel } from '@clack/prompts';

const EXAMPLES_DIR = new URL('../examples/', import.meta.url);

interface PackageJson {
	name?: string;
	exports?: Record<string, string>;
}

interface ExampleEntry {
	name: string;
	type: 'standalone' | 'category';
	file: URL;
	subs?: { name: string; file: URL }[];
}

async function getExamples(): Promise<ExampleEntry[]> {
	const entries = await readdir(EXAMPLES_DIR, { withFileTypes: true });
	const result: ExampleEntry[] = [];

	for (const e of entries) {
		if (!e.isDirectory()) continue;
		const dir = new URL(`${e.name}/`, EXAMPLES_DIR);
		const pkgPath = new URL('package.json', dir);

		let pkg: PackageJson;
		try {
			pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
		} catch {
			continue;
		}

		if (!pkg.exports) continue;

		const exampleExports = Object.entries(pkg.exports).filter(([p]) => p !== './package.json');
		if (exampleExports.length === 0) continue;

		const dotEntry = exampleExports.find(([p]) => p === '.');

		if (dotEntry && exampleExports.length === 1) {
			result.push({
				name: e.name,
				type: 'standalone',
				file: new URL(dotEntry[1], dir),
			});
		} else if (exampleExports.length > 0) {
			const subs = exampleExports
				.filter(([x]) => x !== '.')
				.map(([x, v]) => ({
					name: x.replace(/^\.\//, ''),
					file: new URL(v, dir),
				}))
				.toSorted((a, b) => a.name.localeCompare(b.name));

			if (subs.length > 0) {
				result.push({ name: e.name, type: 'category', file: dir, subs });
			}
		}
	}

	return result.toSorted((a, b) => a.name.localeCompare(b.name));
}

const examples = await getExamples();
const args = parse(process.argv.slice(2), {
	boolean: ['watch'],
	string: ['example', 'sub'],
	alias: { w: 'watch', e: 'example', s: 'sub' },
});

let example: string | undefined = args.example;
let subExample: string | undefined = args.sub;

// select the top level example
if (!example) {
	if (examples.length === 0) {
		console.info('No examples found in examples/');
		process.exit(1);
	}

	const result = await select({
		message: 'Select an example:',
		options: examples.map((e) => ({
			// Arrow suffix hints that there's a second prompt coming
			label: e.type === 'category' ? `${e.name} →` : e.name,
			value: e.name,
		})),
	});

	if (isCancel(result) || !result) {
		process.exit(0);
	}

	example = result;
}

const entry = examples.find((e) => e.name === example);
if (!entry) {
	console.error(`Example "${example}" not found`);
	process.exit(1);
}

let targetFile = entry.file;

// if top level example is a category, select the sub-example
if (entry.type === 'category' && entry.subs) {
	if (!subExample) {
		if (entry.subs.length === 1) {
			// TS why no narrow?
			subExample = entry.subs[0]!.name;
		} else {
			const result = await select({
				message: `Select a ${entry.name} example\nwhere {dependency}/{example name}:`,
				options: entry.subs.map((s) => ({ label: s.name, value: s.name })),
			});

			if (isCancel(result) || !result) {
				process.exit(0);
			}

			subExample = result;
		}
	}

	const sub = entry.subs.find((s) => s.name === subExample);
	if (!sub) {
		console.error(`Example "${subExample}" not found in ${example}`);
		process.exit(1);
	}

	targetFile = sub.file;
}

// fileURLToPath at boundary — spawn requires a string path
const child = spawn(
	'node',
	['--experimental-transform-types', ...(args.watch ? ['--watch'] : []), fileURLToPath(targetFile)],
	{
		stdio: 'inherit',
	},
);

child.on('exit', (code) => {
	process.exit(code ?? 0);
});

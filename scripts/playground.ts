import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@bomb.sh/args';
import { select, isCancel } from '@clack/prompts';

const EXAMPLES_DIR = new URL('../examples/', import.meta.url);

async function getExamples(): Promise<string[]> {
	const entries = await readdir(EXAMPLES_DIR, { withFileTypes: true });
	return entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();
}

const examples = await getExamples();
const args = parse(process.argv.slice(2), {
	string: ['example'],
	alias: { e: 'example' },
});

let example: string | undefined = args.example;

if (!example) {
	if (examples.length === 0) {
		console.log('No examples found in examples/');
		process.exit(1);
	}

	const result = await select({
		message: 'Select an example to run:',
		options: examples.map((name) => ({
			label: name,
			value: name,
		})),
	});

	if (isCancel(result) || !result) {
		process.exit(0);
	}

	example = result;
}

const exampleRoot = new URL(`./${example}/`, EXAMPLES_DIR);
const exampleIndex = new URL(`./src/index.ts`, exampleRoot);
const child = spawn('node', ['--experimental-transform-types', fileURLToPath(exampleIndex)], {
	cwd: fileURLToPath(exampleRoot),
	stdio: 'inherit',
});

child.on('exit', (code) => {
	process.exit(code ?? 0);
});

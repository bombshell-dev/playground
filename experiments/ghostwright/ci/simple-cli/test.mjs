import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { withTerminal } from 'ghostwright';
import { recordingExtension } from 'ghostwright/recording';

test('built Ghostwright records a real CLI conversation', { timeout: 180_000 }, async () => {
	const output = process.env.GHOSTWRIGHT_RECORD_DIR;
	assert.ok(output, 'GHOSTWRIGHT_RECORD_DIR must select the artifact directory');
	const resolved = import.meta.resolve('ghostwright');
	assert.match(resolved, /node_modules\/ghostwright\/dist\/index\.js$/);
	assert.match(
		import.meta.resolve('ghostwright/recording'),
		/node_modules\/ghostwright\/dist\/recording\.js$/,
	);
	await mkdir(output, { recursive: true });
	await writeFile(
		`${output}/source.json`,
		JSON.stringify(
			{
				commit: process.env.GHOSTWRIGHT_SOURCE_SHA ?? 'local',
				package: resolved,
				node: process.version,
			},
			null,
			2,
		),
	);
	const recording = recordingExtension({
		output: `${output}/simple-cli`,
		formats: ['mp4'],
		stepMs: 800,
	});
	await withTerminal(
		{
			command: '/bin/sh',
			args: [
				'-c',
				`printf 'What is your name? '; IFS= read -r name; printf '\\r\\nHello, %s!\\r\\n' "$name"`,
			],
			viewport: { columns: 40, rows: 6 },
			extensions: [recording],
			trace: 'off',
		},
		async (terminal) => {
			using _capture = recording;
			const prompt = await terminal.screen.findByText('What is your name?');
			await terminal.keyboard.type('Ada');
			await terminal.keyboard.press('Enter');
			const greeting = await terminal.screen.findByText('Hello, Ada!');
			assert.equal(greeting.text(), 'Hello, Ada!');
			assert.equal(prompt.text(), 'What is your name?');
			const status = await terminal.process.waitForExit();
			assert.equal(status.exitCode, 0);
			assert.equal(status.ptyEof, true);
		},
	);
});

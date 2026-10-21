import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { recordingExtension, type RecordingEvent } from '../spikes/recording.ts';
test('recording extensions export automatically after a real PTY interaction', async () => {
	const { launchTerminal } = await import('../src/async.ts');
	const directory = await mkdtemp(`${tmpdir()}/ghostwright-pty-recording-`);
	try {
		const recording = recordingExtension({ output: `${directory}/pty` });
		{
			await using terminal = await launchTerminal({
				command: process.execPath,
				args: [
					'-e',
					"console.log('ready'); process.stdin.on('data', data => console.log('received:' + data.toString().trim()));",
				],
				extensions: [recording],
				trace: 'off',
			});
			using _capture = recording;
			await terminal.screen.findByText('ready');
			await terminal.keyboard.type('hello');
			await terminal.keyboard.press('Enter');
			await terminal.screen.findByText('received:hello');
		}
		const trace = JSON.parse(await readFile(`${directory}/pty.json`, 'utf8')) as {
			events: RecordingEvent[];
		};
		expect(trace.events.filter((event) => event.kind === 'interaction')).toMatchObject([
			{ action: { kind: 'write', bytes: 5, base64: 'aGVsbG8=', redacted: false } },
			{ action: { kind: 'write', bytes: 1 } },
		]);
		const frames = trace.events.filter((event) => event.kind === 'frame');
		expect(
			frames
				.at(-1)
				?.screen.lines.map((line) => line.text)
				.join('\n'),
		).toContain('received:hello');
		expect(await readFile(`${directory}/pty.cast`, 'utf8')).toContain('"version":2');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('failed PTY launch awaits extension cleanup', async () => {
	const { launchTerminal } = await import('../src/async.ts');
	let cleaned = false;
	await expect(
		launchTerminal({
			command: '/ghostwright-missing-command',
			trace: 'off',
			extensions: [
				{
					id: 'cleanup-probe',
					setup: () => async () => {
						await Promise.resolve();
						cleaned = true;
					},
				},
			],
		}),
	).rejects.toThrow('Unable to launch');
	expect(cleaned).toBe(true);
});

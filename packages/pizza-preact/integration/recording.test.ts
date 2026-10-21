import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { GhostwrightError } from '../../../experiments/ghostwright/src/errors.ts';
import { expect, test } from 'vitest';
import { createTerminal } from '../../../experiments/ghostwright/spikes/in-process.ts';
import {
	LocalRecording,
	recordingExtension,
	snapshotAnsi,
	toAsciicast,
	type RecordingEvent,
} from '../../../experiments/ghostwright/spikes/recording.ts';

async function write(
	terminal: Awaited<ReturnType<typeof createTerminal>>,
	text: string,
): Promise<void> {
	await new Promise<void>((resolve, reject) =>
		terminal.stdout.write(text, (error) => (error ? reject(error) : resolve())),
	);
}

test('snapshot export preserves Ghostty text, wide cells, colors, styles and cursor', async () => {
	await using terminal = await createTerminal({ viewport: { columns: 18, rows: 4 } });
	await using replay = await createTerminal({ viewport: { columns: 18, rows: 4 } });
	await write(
		terminal,
		'\x1b[2J\x1b[H\x1b[1;3;4;38;2;12;34;56;48;5;17m界é hello\x1b[0m\x1b[3;4Hcursor\x1b[3;5H\x1b[6 q\x1b[?25h',
	);
	const screen = terminal.screen.current();
	await write(replay, snapshotAnsi(screen));
	const visibleCells = (lines: typeof screen.lines): typeof screen.lines =>
		lines.map((line) => ({
			...line,
			cells: line.cells.map((cell) => ({ ...cell, text: cell.text || ' ' })),
		}));
	expect(visibleCells(replay.screen.current().lines)).toEqual(visibleCells(screen.lines));
	expect(replay.screen.current().cursor).toEqual(screen.cursor);
});

test('capture keeps interactions and frames, isolates sessions and stops before teardown', async () => {
	const directory = await mkdtemp(`${tmpdir()}/ghostwright-recording-`);
	try {
		const capture = recordingExtension({ output: `${directory}/capture` });
		await using terminal = await createTerminal({
			viewport: { columns: 18, rows: 4 },
			extensions: [capture],
		});
		await using other = await createTerminal();
		try {
			using _scope = capture;
			await write(terminal, 'Before');
			await terminal.keyboard.type('example');
			await write(terminal, '\rAfter ');
			await write(other, 'other session');
			throw new GhostwrightError({ code: 'TEST_FAILURE', message: 'assertion failed' });
		} catch (error) {
			expect((error as Error).message).toBe('assertion failed');
		}
		await write(terminal, '\x1b[2J\x1b[Hteardown');
		const paths = await capture.export();
		expect(paths).toHaveLength(2);
		const trace = JSON.parse(await readFile(paths[0], 'utf8')) as { events: RecordingEvent[] };
		expect(trace.events.filter((event) => event.kind === 'interaction')).toMatchObject([
			{ action: { kind: 'type', text: 'example' } },
		]);
		const frames = trace.events.filter((event) => event.kind === 'frame');
		expect(frames.at(-1)?.screen.lines[0].text.trim()).toBe('After');
		expect(JSON.stringify(trace)).not.toContain('teardown');
		const cast = (await readFile(paths[1], 'utf8'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(cast[0]).toMatchObject({ version: 2, width: 18, height: 4 });
		const action = cast.find((event) => event[1] === 'm');
		expect(action[0]).toBeGreaterThanOrEqual(0.45);
		const originalAction = trace.events.find((event) => event.kind === 'interaction')!;
		expect(action[0] * 1000).toBeGreaterThanOrEqual(originalAction.at);
		const realTime = toAsciicast(trace.events, 0)
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(realTime.find((event) => event[1] === 'm')[0]).toBe(originalAction.at / 1000);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('encoder errors keep the recording and capture has a bounded event limit', async () => {
	const directory = await mkdtemp(`${tmpdir()}/ghostwright-recording-`);
	try {
		using capture = recordingExtension({
			output: `${directory}/retained`,
			formats: ['gif'],
			agg: `${directory}/missing-encoder`,
		});
		const terminal = await createTerminal({ extensions: [capture] });
		await write(terminal, 'Retained after encoder error');
		await expect(capture.export()).rejects.toThrow('The .cast and .json recording were saved');
		expect(await readFile(`${directory}/retained.json`, 'utf8')).toContain(
			'Retained after encoder error',
		);
		using bounded = new LocalRecording(terminal.screen.current(), () => {}, 1);
		expect(() => bounded.frame(terminal.screen.current())).toThrow('exceeded 1 events');
		await expect(terminal[Symbol.asyncDispose]()).rejects.toThrow(
			'Terminal extension cleanup failed',
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('extensions roll back setup and await every cleanup once, even when one fails', async () => {
	const calls: string[] = [];
	await expect(
		createTerminal({
			extensions: [
				{
					id: 'first',
					setup: () => async () => {
						await Promise.resolve();
						calls.push('first');
					},
				},
				{
					id: 'broken',
					setup: () => {
						throw new GhostwrightError({ code: 'TEST_SETUP', message: 'setup failed' });
					},
				},
			],
		}),
	).rejects.toThrow('setup failed');
	expect(calls).toEqual(['first']);
	const terminal = await createTerminal({
		extensions: [
			{
				id: 'one',
				setup: () => async () => {
					await Promise.resolve();
					calls.push('one');
				},
			},
			{
				id: 'two',
				setup: () => () => {
					calls.push('two');
					throw new GhostwrightError({ code: 'TEST_CLEANUP', message: 'cleanup failed' });
				},
			},
		],
	});
	await expect(terminal[Symbol.asyncDispose]()).rejects.toThrow(
		'Terminal extension cleanup failed',
	);
	await expect(terminal[Symbol.asyncDispose]()).rejects.toThrow(
		'Terminal extension cleanup failed',
	);
	expect(calls).toEqual(['first', 'two', 'one']);
	expect(terminal.stdin.destroyed).toBe(true);
	expect(terminal.stdout.destroyed).toBe(true);
});

import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
// oxlint-disable-next-line no-restricted-imports -- path module needed for path resolution
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import {
	expectTerminal,
	HistoryEvictedError,
	replayTrace,
	StrictLocatorError,
	TerminalAssertionError,
	withTerminalAsync,
} from '../src/index.ts';

const node = process.execPath;

test('lazy locators preserve wide-cell geometry and strictness', async () => {
	await withTerminalAsync(
		{
			command: node,
			args: ['-e', `setTimeout(() => process.stdout.write("文字 unique duplicate duplicate"), 20)`],
			viewport: { columns: 50, rows: 4 },
			trace: 'off',
		},
		async (terminal) => {
			const wide = terminal.getByText('文字');
			const match = await expectTerminal(wide).toBePresent();
			expect(match.range).toEqual({ column: 0, row: 0, width: 4, height: 1 });
			await expect(terminal.getByText('duplicate').click()).rejects.toBeInstanceOf(
				StrictLocatorError,
			);
			expect(terminal.getByText('duplicate').nth(1).matches()[0].range.column).toBeGreaterThan(
				terminal.getByText('duplicate').nth(0).matches()[0].range.column,
			);
		},
	);
});

test('visual stability uses the existing visual-change timestamp', async () => {
	await withTerminalAsync(
		{
			command: node,
			args: ['-e', `process.stdout.write("stable"); setTimeout(() => {}, 250)`],
			trace: 'off',
		},
		async (terminal) => {
			await expectTerminal(terminal.getByText('stable')).toBePresent();
			await new Promise((resolve) => setTimeout(resolve, 120));
			const started = performance.now();
			await expectTerminal(terminal.getByText('stable')).toBeStable({ settleMs: 100 });
			expect(performance.now() - started).toBeLessThan(50);
		},
	);
});

test('history eviction is explicit', async () => {
	await withTerminalAsync(
		{
			command: node,
			args: [
				'-e',
				`let i=0; const timer=setInterval(() => { process.stdout.write("\\r" + i++); if(i===8){clearInterval(timer);setTimeout(()=>process.exit(),20)} }, 15)`,
			],
			history: { maxRevisions: 2 },
			trace: 'off',
		},
		async (terminal) => {
			const receipt = await terminal.resize({ columns: 80, rows: 24 });
			await terminal.process.waitForExit();
			await expect(
				expectTerminal(terminal).toHaveShownText('never', { since: receipt, timeoutMs: 10 }),
			).rejects.toBeInstanceOf(HistoryEvictedError);
		},
	);
});

test('trace-on artifacts replay the same final terminal state', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'ghostwright-replay-test-'));
	try {
		let expected = '';
		await withTerminalAsync(
			{
				command: node,
				args: ['-e', `process.stdout.write("first\\rsecond")`],
				trace: { policy: 'on', directory },
			},
			async (terminal) => {
				await terminal.process.waitForExit();
				expected = terminal.screen.getText();
			},
		);
		const [artifact] = await readdir(directory),
			replay = await replayTrace(join(directory, artifact));
		expect(replay.finalSnapshot.lines.map((line) => line.text).join('\n')).toBe(expected);
		expect(replay.revisions.length).toBeGreaterThan(0);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('marked input is redacted from trace bytes', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'ghostwright-redaction-test-'));
	try {
		await withTerminalAsync(
			{
				command: node,
				args: [
					'-e',
					`process.stdin.setRawMode(true); process.stdout.write("READY"); process.stdin.once("data", () => process.exit(0))`,
				],
				trace: { policy: 'on', directory },
			},
			async (terminal) => {
				await expectTerminal(terminal.getByText('READY')).toBePresent();
				await terminal.keyboard.type('synthetic-input-secret', { trace: 'redact' });
				await terminal.process.waitForExit();
			},
		);
		const [artifact] = await readdir(directory),
			path = join(directory, artifact),
			trace = await readFile(join(path, 'trace.jsonl'), 'utf8'),
			raw = await readFile(join(path, 'output.bin'));
		expect(trace).toContain('"redacted":true');
		expect(trace).not.toContain('synthetic-input-secret');
		expect(raw.includes(Buffer.from('synthetic-input-secret'))).toBe(false);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('retain-on-failure writes private complete artifacts and preserves the primary error', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'ghostwright-trace-test-'));
	try {
		let failure: unknown;
		try {
			await withTerminalAsync(
				{
					command: node,
					args: ['-e', `process.stdout.write("actual")`],
					trace: { policy: 'retain-on-failure', directory, redactArgumentIndexes: [1] },
					env: { API_TOKEN: 'synthetic-secret' },
					name: 'trace test',
				},
				async (terminal) => {
					await expectTerminal(terminal.getByText('missing')).toBePresent({ timeoutMs: 30 });
				},
			);
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(TerminalAssertionError);
		const tracePath = (failure as TerminalAssertionError).tracePath!;
		expect(tracePath).toBeTruthy();
		expect((failure as Error).message).toContain('trace artifact:');
		expect((await readdir(tracePath)).toSorted()).toEqual(
			['failure.txt', 'final-screen.txt', 'metadata.json', 'output.bin', 'trace.jsonl'].toSorted(),
		);
		const metadata = await readFile(join(tracePath, 'metadata.json'), 'utf8'),
			trace = await readFile(join(tracePath, 'trace.jsonl'), 'utf8'),
			mode = (await stat(tracePath)).mode & 0o777;
		expect(mode).toBe(0o700);
		expect(metadata).not.toContain('synthetic-secret');
		expect(metadata).toContain('"<redacted>"');
		expect(metadata).toContain('"wasmSha256"');
		expect(trace).toContain('"type":"session-start"');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

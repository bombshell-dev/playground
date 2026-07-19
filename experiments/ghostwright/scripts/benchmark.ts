import { TerminalSession } from '../src/terminal/session.ts';

async function measure(name: string, operation: () => Promise<void>, iterations: number) {
	const samples: number[] = [];
	for (let index = 0; index < iterations; index++) {
		const started = performance.now();
		await operation();
		samples.push(performance.now() - started);
	}
	samples.sort((a, b) => a - b);
	console.log(
		JSON.stringify({
			name,
			iterations,
			medianMs: samples[Math.floor(samples.length / 2)],
			minMs: samples[0],
			maxMs: samples.at(-1),
		}),
	);
}

await measure(
	'launch-exit-cleanup',
	async () => {
		const terminal = await TerminalSession.launch({ command: '/usr/bin/true', trace: 'off' });
		await terminal.process.waitForExit();
		await terminal.close();
	},
	10,
);

await measure(
	'one-megabyte-output',
	async () => {
		const terminal = await TerminalSession.launch({
			command: process.execPath,
			args: ['-e', `process.stdout.write("x".repeat(1024 * 1024))`],
			viewport: { columns: 120, rows: 40 },
			trace: 'off',
		});
		await terminal.process.waitForExit();
		await terminal.close();
	},
	5,
);

import { TerminalSession } from '../src/terminal/session.ts';

async function measure(params: {
	name: string;
	operation: () => Promise<void>;
	iterations: number;
}): Promise<void> {
	const samples: number[] = [];
	for (let index = 0; index < params.iterations; index++) {
		const started = performance.now();
		await params.operation();
		samples.push(performance.now() - started);
	}
	// oxlint-disable-next-line no-console -- benchmark script
	console.log(
		JSON.stringify({
			name: params.name,
			iterations: params.iterations,
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

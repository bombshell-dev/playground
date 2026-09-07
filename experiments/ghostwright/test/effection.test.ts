import { expect, test } from 'bun:test';
import { run } from 'effection';
import { expectTerminal } from '../src';
import { withTerminal } from '../src/effection/index.ts';
test('Effection facade shares scoped session behavior', async () => {
	const result = await run(function* () {
		return yield* withTerminal(
			{ command: '/bin/sh', args: ['-c', 'printf generator'], trace: 'off' },
			function* (terminal) {
				const match = yield* expectTerminal(terminal.getByText('generator')).toBePresent();
				return match.text;
			},
		);
	});
	expect(result).toBe('generator');
});

test('Effection queries and waitFor use the same frozen evidence contracts', async () => {
	const result = await run(function* () {
		return yield* withTerminal(
			{ command: '/bin/sh', args: ['-c', 'printf generator'], trace: 'off' },
			function* (terminal) {
				const found = yield* terminal.screen.findByText('generator');
				const value = yield* terminal.waitFor(() => false);
				expect(value).toBe(false);
				expect(terminal.screen.queryByText('missing')).toBeNull();
				return found.text();
			},
		);
	});
	expect(result).toBe('generator');
});

test('Effection cancellation closes the PTY scope and application process', async () => {
	let pid = 0,
		started!: () => void;
	const ready = new Promise<void>((resolve) => (started = resolve)),
		task = run(function* () {
			return yield* withTerminal(
				{ command: '/bin/sh', args: ['-c', 'while :; do sleep 1; done'], trace: 'off' },
				function* (terminal) {
					pid = terminal.process.status().pid!;
					started();
					yield* expectTerminal(terminal.getByText('never')).toBePresent({ timeoutMs: 60_000 });
				},
			);
		});
	await ready;
	await task.halt();
	expect(() => process.kill(pid, 0)).toThrow();
});

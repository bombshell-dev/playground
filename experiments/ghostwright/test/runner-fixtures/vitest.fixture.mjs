import { expect, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { test } from 'ghostwright/vitest';
import { regionLocator, defineMatchers } from 'ghostwright';
import { createRunnerMatchers } from 'ghostwright/matchers';

const owned = [];
let escapedLaunch;

afterAll(async () => {
	for (const acquiring of owned) {
		const terminal = await acquiring;
		expect(terminal.signal.aborted).toBe(true);
		expect(terminal.process.status().state).toBe('closed');
	}
	await expect(escapedLaunch({ command: '/bin/sh' })).rejects.toMatchObject({
		code: 'GW_SESSION_CLOSED',
	});
	if (process.env.GHOSTWRIGHT_CLEANUP_REPORT)
		await writeFile(
			process.env.GHOSTWRIGHT_CLEANUP_REPORT,
			JSON.stringify({ closed: owned.length }),
		);
});

test('the fixture owns acquisition before it completes', ({ launchTerminal }) => {
	escapedLaunch = launchTerminal;
	owned.push(
		launchTerminal({
			command: process.execPath,
			args: ['-e', 'process.stdin.resume()'],
			trace: 'off',
		}),
	);
});

expect.extend(
	createRunnerMatchers(
		defineMatchers({
			toShowGreeting: (region, name) => ({
				pass: region.text() === `hello ${name}`,
				expected: `greeting for ${name}`,
				actual: region.text(),
			}),
		}),
	),
);

test('real Vitest assertions use frozen terminal evidence and local matchers', async ({
	launchTerminal,
}) => {
	const terminal = await launchTerminal({
		command: process.execPath,
		args: ['-e', 'process.stdout.write("hello Ryan")'],
		trace: 'off',
	});
	const { screen } = terminal;
	const greeting = await screen.findByText('hello Ryan');
	expect(greeting).toBeVisible();
	expect(greeting).toShowGreeting('Ryan');
	expect(greeting).not.toContainText('Ada');
	expect(screen.queryByText('missing')).not.toBeVisible();
	expect(
		screen.getBy(regionLocator({ column: 200, row: 0, width: 1, height: 1 })),
	).not.toBeVisible();
});

if (process.env.GHOSTWRIGHT_NEGATIVE) {
	test('one cleanup failure does not leak another terminal', async ({ launchTerminal }) => {
		owned.push(
			Promise.resolve(
				await launchTerminal({
					command: process.execPath,
					args: ['-e', 'process.stdin.resume()'],
					trace: 'off',
				}),
			),
		);
		owned.push(
			Promise.resolve(
				await launchTerminal({
					command: process.execPath,
					args: ['-e', 'process.stdin.resume()'],
					trace: { policy: 'on', directory: fileURLToPath(import.meta.url) },
				}),
			),
		);
	});
	test('failure artifacts follow the runner outcome', async ({ launchTerminal }) => {
		const terminal = await launchTerminal({
			command: process.execPath,
			args: ['-e', 'process.stdout.write("actual terminal text")'],
			trace: { policy: 'retain-on-failure', directory: process.env.GHOSTWRIGHT_TRACES },
		});
		expect(await terminal.screen.findByText('actual terminal text')).toContainText(
			'expected terminal text',
		);
	});
}

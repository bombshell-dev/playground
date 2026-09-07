import { expect, test } from 'bun:test';
import { launchTerminal } from '../../src/index.ts';

const cli = {
	command: '/bin/sh',
	args: [
		'-c',
		`printf 'What is your name? '; IFS= read -r name; printf '\r\nHello, %s!\r\n' "$name"`,
	],
	viewport: { columns: 40, rows: 6 },
	trace: 'off' as const,
};

test('await using drives a portable CLI and owns terminal cleanup', async () => {
	await using terminal = await launchTerminal(cli);
	const { screen, keyboard } = terminal;
	const prompt = await screen.findByText('What is your name?');

	await keyboard.type('Ada');
	await keyboard.press('Enter');

	const greeting = await screen.findByText('Hello, Ada!');
	expect(greeting.text()).toBe('Hello, Ada!');
	// A query result keeps its original evidence after later output.
	expect(prompt.text()).toBe('What is your name?');

	const status = await terminal.process.waitForExit();
	expect(status.exitCode).toBe(0);
	expect(status.ptyEof).toBe(true);
});

import { expect, test } from 'vitest';
import { cellsMatchStyle, expectTerminal, withTerminalAsync } from 'ghostwright';
import {
	clackTtyExtension,
	expectFocused,
	expectTreeCondition,
	type ClackTtySession,
} from '@ghostwright/clack-tty';

// The application under test is this package's hello-world; it contains no
// test code itself. The launcher environment activates the semantic producer
// through the extension declared in package.json.
const extension = clackTtyExtension();

const entry = () => ({
	command: process.execPath,
	args: ['--import', 'tsx', 'src/hello-world.ts'],
	cwd: new URL('..', import.meta.url).pathname,
	viewport: { columns: 80, rows: 24 },
	env: { CLACK_UI_SEMANTIC: '1' },
	trace: 'off' as const,
	extensions: [extension],
});

test('the greeting renders and the semantic tree exposes it (selector syntax)', async () => {
	await withTerminalAsync(entry(), async (terminal) => {
		const semantic = terminal.extension(extension) as ClackTtySession;

		// The group box is in the tree before we ever look at the screen.
		const group = semantic.locator('box[role="group"][label="hello"]');
		await expectTreeCondition(terminal, () => group.matches().length === 1, 'group present');

		// The bridge: text assertions scoped to the group's on-screen rect.
		await expectTerminal(group.getByText('Hello, World!')).toBeStable();
	});
});

test('typing into the say input updates the greeting (region-scoped)', async () => {
	await withTerminalAsync(entry(), async (terminal) => {
		const semantic = terminal.extension(extension) as ClackTtySession;
		const group = semantic.locator('box[role="group"][label="hello"]');
		const say = semantic.locator('input[label="say"]');

		await expectTerminal(terminal.getByText('Hello, World!')).toBeStable();
		await expectFocused(terminal, say);

		await terminal.keyboard.type('Hi');

		// The greeting text element and the input's own model both updated.
		await expectTerminal(group.getByText('Hi, World!')).toBeStable();
		await expectTerminal(say.getByText('Hi')).toBePresent();
	});
});

test('Tab moves focus and the focused input paints its focus ring', async () => {
	await withTerminalAsync(entry(), async (terminal) => {
		const semantic = terminal.extension(extension) as ClackTtySession;
		const say = semantic.locator('input[label="say"]');
		const to = semantic.locator('input[label="to"]');

		await expectFocused(terminal, say);

		// Focus is visual: the focused input draws white, the other gray.
		const foregroundOf = (locator: typeof say) => {
			const [match] = locator.matches();
			const cells = terminal.screen.getCells(match!.range!);
			const focused = cells.some((cell) => cellsMatchStyle([cell], { foreground: '#ffffff' }));
			const gray = cells.some((cell) => cellsMatchStyle([cell], { foreground: '#646464' }));
			return { focused, gray };
		};
		expect(foregroundOf(say)).toEqual({ focused: true, gray: false });
		expect(foregroundOf(to)).toEqual({ focused: false, gray: true });

		await terminal.keyboard.press('Tab');
		await expectFocused(terminal, to);
		expect(foregroundOf(to)).toEqual({ focused: true, gray: false });
		expect(foregroundOf(say)).toEqual({ focused: false, gray: true });
	});
});

test('ambiguous selectors fail with candidate diagnostics', async () => {
	await withTerminalAsync(entry(), async (terminal) => {
		const semantic = terminal.extension(extension) as ClackTtySession;
		await expectTerminal(terminal.getByText('Hello, World!')).toBeStable();

		try {
			semantic.locator('input').unique();
			expect.unreachable('unique() must throw on ambiguity');
		} catch (error) {
			const message = (error as Error).message;
			expect(message).toContain('matched 2');
			expect(message).toContain('/input');
		}

		await expect(
			expectTreeCondition(
				terminal,
				() => semantic.locator('input[label="nope"]').matches().length > 0,
				'never matches',
				1500,
			),
		).rejects.toThrow(/never matches/);
	});
});

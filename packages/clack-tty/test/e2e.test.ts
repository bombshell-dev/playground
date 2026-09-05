import { expect, test } from 'vitest';
import { withTerminalAsync, regionLocator } from 'ghostwright';
import { clackTtyExtension, expectUI, locator } from '../src/index.ts';

const entry = () => ({
	command: process.execPath,
	args: ['--import', 'tsx', 'src/hello-world.ts'],
	cwd: new URL('../../hello-world', import.meta.url).pathname,
	env: { CLACK_UI_SEMANTIC: '1' },
	trace: 'off' as const,
	extensions: [clackTtyExtension()],
});

test('producer and CSS adapter compose with core assertions over real terminal output', async () => {
	await withTerminalAsync(entry(), async (ui) => {
		const say = locator('input[label="say"]');
		await expectUI(ui, say).toHaveInputFocus();
		await ui.keyboard.type('Hi');
		await ui.expect(say).toContainText('Hi');
		await ui.expect(locator('box[label="hello"]')).toContainText('Hi, World!');
		const to = locator('input[label="to"]');
		await ui.keyboard.press('Tab');
		await expectUI(ui, to).toHaveInputFocus();
		await ui.expect(say).toHaveEdgeStyle('top', { foreground: '#646464' });
	});
});

test('ambiguous location fails immediately, not as an assertion timeout', async () => {
	await withTerminalAsync(entry(), async (ui) => {
		await expectUI(ui, locator('input[label="say"]')).toHaveInputFocus();
		await expect(ui.expect(locator('input')).toContainCursor()).rejects.toMatchObject({
			code: 'GW_LOCATOR_STRICT',
		});
	});
});

test('semantic emission is opt-in; a missing description cannot prove visibility', async () => {
	await withTerminalAsync({ ...entry(), env: {}, assertionTimeoutMs: 1000 }, async (ui) => {
		await ui
			.expect(regionLocator({ column: 0, row: 0, width: 80, height: 24 }))
			.toContainText('Hello, World!');
		await expect(ui.expect(locator('input')).toContainCursor()).rejects.toMatchObject({
			code: 'GW_ASSERTION',
		});
		expect(Buffer.from(ui.screen.rawOutput()).toString()).not.toContain('7777;clack.ui');
	});
});

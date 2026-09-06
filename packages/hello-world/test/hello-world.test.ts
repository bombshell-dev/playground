import { test } from 'vitest';
import { withTerminalAsync, type TerminalLaunchOptions } from 'ghostwright';
import { clackTtyExtension, expectUI, locator } from '@ghostwright/clack-tty';

const entry = (): TerminalLaunchOptions => ({
	command: process.execPath,
	args: ['--import', 'tsx', 'src/hello-world.ts'],
	cwd: new URL('..', import.meta.url).pathname,
	env: { CLACK_UI_SEMANTIC: '1' },
	extensions: [clackTtyExtension()],
});

test('greeting reacts to typing through the real terminal', async () => {
	const say = locator('input[label="say"]');
	const to = locator('input[label="to"]');
	const group = locator('box[label="hello"]');
	await withTerminalAsync(entry(), async (ui) => {
		await ui.expect(group).toContainText('Hello, World!');
		await expectUI(ui, say).toHaveInputFocus();
		await ui.keyboard.type('Hi');
		await ui.expect(group).toContainText('Hi, World!');
		await ui.expect(say).toContainText('Hi');
		await ui.keyboard.press('Tab');
		await expectUI(ui, to).toHaveInputFocus();
		await ui.expect(say).toHaveEdgeStyle('top', { foreground: '#646464' });
	});
});

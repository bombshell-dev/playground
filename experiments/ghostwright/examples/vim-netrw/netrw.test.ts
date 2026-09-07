import { expect, test } from 'bun:test';
import { netrw } from './netrw.ts';
import { withVim } from './fixture.ts';

for (const viewport of [
	{ columns: 80, rows: 24 },
	{ columns: 100, rows: 36 },
]) {
	test(`open a file from Vim's explorer at ${viewport.columns}×${viewport.rows}`, async () => {
		await withVim({ viewport }, async (ui) => {
			const explorer = netrw(ui);
			const readme = explorer.find('README.md');

			// Recognize the explorer, then find a file inside it. The other window
			// also says "README.md", but it is not an explorer entry.
			await ui.expect(explorer.region).toContainText('Netrw Directory Listing');
			await ui.expect(readme.region).toContainText('README.md');

			// The adapter navigates with normal-mode keys and presses Enter.
			// It does not ask Vim for a buffer, filename, or window coordinate.
			await readme.open();
			await ui.expect(readme.editor).toContainText('# Opened through the explorer');
			await ui.expect(readme.editor).toContainText('This text came from README.md.');
			await ui.expect(readme.editor).toContainCursor({ visible: true });

			await ui.keyboard.type(':qa!');
			await ui.keyboard.press('Enter');
			expect((await ui.process.waitForExit()).exitCode).toBe(0);
		});
	});
}

test('open an earlier file after moving to the end of the listing', async () => {
	await withVim({ viewport: { columns: 80, rows: 24 } }, async (ui) => {
		const explorer = netrw(ui);
		await ui.expect(explorer.region).toContainCursor({ visible: true });
		await ui.keyboard.type('G');
		await ui.expect(explorer.find('WELCOME.txt').region).toContainCursor({ visible: true });
		const readme = explorer.find('README.md');
		await readme.open();
		await ui.expect(readme.editor).toContainText('# Opened through the explorer');
	});
});

test('refuse to navigate when the cursor belongs to the neighboring editor', async () => {
	await withVim({ viewport: { columns: 80, rows: 24 } }, async (ui) => {
		const explorer = netrw(ui);
		await ui.expect(explorer.region).toContainCursor({ visible: true });
		await ui.keyboard.press({ key: 'w', control: true });
		await ui.keyboard.type('l');
		await ui.expect(explorer.region).toSatisfy((region) => ({
			pass: region.screen.cursor.visible && !region.cursor().inside,
			expected: 'cursor in the neighboring window',
			actual: region.cursor(),
		}));
		await expect(explorer.find('README.md').open()).rejects.toMatchObject({ code: 'GW_VIM_FOCUS' });
	});
});

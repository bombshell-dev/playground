import { expect, test } from 'vitest';
import {
	defineScreenLocator,
	regionLocator,
	withTerminal,
	type AsyncExecution,
	type TerminalLaunchOptions,
} from 'ghostwright';
import { clackTtyExtension, locator } from '../src/index.ts';

const panel = defineScreenLocator('panel', (screen) =>
	screen.lines.flatMap((line) =>
		line.text.trim() === 'Panel' ? [{ column: 0, row: line.row, width: 40, height: 5 }] : [],
	),
);
const spatialSubmit = panel.derive('submit', (region) =>
	region
		.text()
		.split('\n')
		.flatMap((line, row) => {
			const column = line.indexOf('[Submit]');
			return column === -1
				? []
				: [
						{
							column: region.bounds.column + column,
							row: region.bounds.row + row,
							width: 8,
							height: 1,
						},
					];
		}),
);

const cases = [
	{
		name: 'spatial',
		described: false,
		submit: spatialSubmit,
		status: regionLocator({ column: 0, row: 0, width: 40, height: 1 }),
		path: 'panel >> submit',
	},
	{
		name: 'DOM',
		described: true,
		submit: locator('form[label="delivery"]').locator('button[label="submit"]'),
		status: locator('text[label="status"]'),
		path: 'form[label="delivery"] >> button[label="submit"]',
	},
];

for (const query of cases) {
	const launch = (
		mode: 'missing-parent' | 'missing-child' | 'ambiguous',
	): TerminalLaunchOptions => ({
		command: process.execPath,
		args: [
			'--import',
			import.meta.resolve('tsx'),
			new URL('fixtures/action-target.ts', import.meta.url).pathname,
		],
		cwd: new URL('..', import.meta.url).pathname,
		env: { ACTION_TARGET: mode, DESCRIBE: query.described ? '1' : '0' },
		extensions: query.described ? [clackTtyExtension()] : [],
		assertionTimeoutMs: 1000,
		trace: 'off' as const,
	});

	for (const missing of ['missing-parent', 'missing-child'] as const) {
		test(`${query.name} click waits for ${missing} before sending mouse input`, async () => {
			await withTerminal(launch(missing), async (ui) => {
				await ui.expect(query.status).toContainText('Loading');
				// Start the click while its target is absent. Enter is the fixture's
				// real interaction for revealing the form; it releases the pending click.
				await Promise.all([ui.mouse.click(query.submit), ui.keyboard.press('Enter')]);
				await ui.expect(query.status).toContainText('Submitted: 1');
				const input = await finishInputAudit(ui);
				expect(input.startsWith('\r')).toBe(true); // No input preceded the reveal key.
				expect(ui.screen.getText()).toContain('Submitted: 1'); // No second click after the first assertion.
			});
		});
	}

	test(`${query.name} hover resolves a target and transmits its modifier`, async () => {
		await withTerminal(launch('ambiguous'), async (ui) => {
			await ui.expect(query.status).toContainText('Ready');
			await ui.mouse.hover(query.submit.nth(0), { control: true });
			await ui.expect(query.status).toContainText('Hover: control');
			expect(await finishInputAudit(ui)).toBe('\x1b[<51;8;3M');
		});
	});

	test(`${query.name} invalid drag destination sends no button-down`, async () => {
		await withTerminal(launch('ambiguous'), async (ui) => {
			await ui.expect(query.status).toContainText('Ready');
			await expect(
				ui.mouse.drag(query.submit.nth(0), { by: { columns: Infinity, rows: 0 } }),
			).rejects.toMatchObject({ code: 'GW_COORDINATE_RANGE' });
			expect(await finishInputAudit(ui)).toBe('');
		});
	});

	test(`${query.name} ambiguity includes the whole path and sends no input`, async () => {
		await withTerminal(launch('ambiguous'), async (ui) => {
			await ui.expect(query.status).toContainText('Ready');
			await expect(ui.mouse.click(query.submit)).rejects.toMatchObject({
				code: 'GW_LOCATOR_STRICT',
				message: expect.stringContaining(query.path),
			});
			expect(await finishInputAudit(ui)).toBe('');
		});
	});

	test(`${query.name} timeout includes the whole path and sends no input`, async () => {
		await withTerminal(launch('missing-child'), async (ui) => {
			await ui.expect(query.status).toContainText('Loading');
			await expect(ui.mouse.click(query.submit)).rejects.toMatchObject({
				code: 'GW_ASSERTION',
				message: expect.stringContaining(query.path),
			});
			expect(await finishInputAudit(ui)).toBe('');
		});
	});

	test(`${query.name} exit while waiting identifies the full query path`, async () => {
		await withTerminal(launch('missing-child'), async (ui) => {
			await ui.expect(query.status).toContainText('Loading');
			await Promise.all([
				expect(ui.mouse.click(query.submit)).rejects.toMatchObject({
					code: 'GW_PROCESS_EXITED',
					message: expect.stringContaining(query.path),
				}),
				finishInputAudit(ui).then((input) => expect(input).toBe('')),
			]);
		});
	});
}

/** The finish key is a PTY stream barrier, after all input preceding it.
 * The fixture audits that prefix, flushes its report, and exits. No timing guess. */
async function finishInputAudit(ui: AsyncExecution): Promise<string> {
	await ui.keyboard.type('!');
	await ui.process.waitForExit();
	const audit = ui.screen
		.getText()
		.split('\n')
		.find((line) => line.startsWith('INPUT:'))
		?.slice(6)
		.trim();
	expect(audit).toBeDefined();
	return audit === '(none)' ? '' : Buffer.from(audit!, 'hex').toString('latin1');
}

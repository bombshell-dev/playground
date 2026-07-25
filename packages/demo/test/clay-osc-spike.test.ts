import { expect, test } from 'bun:test';
import { expectTerminal, withTerminalAsync } from 'ghostwright';
import { ClayMetadataExtension, parseClayFrames } from './support/clay-metadata-extension.ts';

const app = {
	command: 'bun',
	args: ['src/clay-osc-spike.ts'],
	cwd: import.meta.dir + '/..',
	viewport: { columns: 60, rows: 15 },
	trace: 'off' as const,
};

test('a custom OSC locates a tty element by its Clay ID', async () => {
	await withTerminalAsync(app, async (terminal) => {
		await expectTerminal(terminal.getByText('Clay semantic target')).toBeStable();

		const clay = new ClayMetadataExtension(terminal),
			frame = clay.current(),
			target = clay.getById('semantic-target');

		expect(frame?.version).toBe(1);
		expect(frame?.frame).toBe(1);
		expect(target).toBeDefined();
		expect(target?.id).toBe('semantic-target');

		// Clay centered a 30x5 element in the 60x15 terminal. These coordinates
		// come from tty's result.info.get(id), not from screen text archaeology.
		expect(target?.bounds).toEqual({ column: 15, row: 5, width: 30, height: 5 });

		// The returned bounds compose with Ghostwright's existing locator API.
		await expectTerminal(target!.getByText('Clay semantic target')).toBePresent();

		// And they correspond to the real visible box, not merely a plausible
		// metadata payload.
		const { column, row, width, height } = target!.bounds;
		expect(terminal.screen.getCell({ column, row }).text).toBe('┌');
		expect(terminal.screen.getCell({ column: column + width - 1, row }).text).toBe('┐');
		expect(terminal.screen.getCell({ column, row: row + height - 1 }).text).toBe('└');
		expect(
			terminal.screen.getCell({ column: column + width - 1, row: row + height - 1 }).text,
		).toBe('┘');

		// The OSC is retained in raw PTY bytes for the extension, but Ghostty
		// ignores it and it never appears in the terminal grid.
		const raw = Buffer.from(terminal.screen.rawOutput()).toString('latin1');
		expect(raw).toContain('\u001b]7777;ghostwright.clay;v=1;');
		expect(terminal.screen.getText()).not.toContain('ghostwright.clay');
		expect(terminal.screen.getText()).not.toContain('semantic-target');
	});
});

test('the spike parser tolerates an OSC split before its terminator', () => {
	const frame = { version: 1, frame: 7, elements: [] },
		payload = Buffer.from(JSON.stringify(frame)).toString('base64url'),
		incomplete = Buffer.from(`\u001b]7777;ghostwright.clay;v=1;${payload}`),
		complete = Buffer.concat([incomplete, Buffer.from('\u001b\\')]);

	expect(parseClayFrames(incomplete)).toEqual([]);
	expect(parseClayFrames(complete)).toEqual([frame]);
});

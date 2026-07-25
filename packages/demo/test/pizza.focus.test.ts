/**
 * Acceptance: keyboard focus traversal between the pizza form's text fields.
 *
 * Focus is asserted purely from visible terminal state, with no application
 * instrumentation. pizza.ts expresses focus on a text field two independent
 * ways (see makeField in src/pizza.ts):
 *
 *   1. the field's box border is drawn WHITE when focused and GRAY otherwise
 *   2. only the focused field renders a caret, so the terminal cursor sits
 *      inside that field's box
 *
 * Both are checked, so the test fails if either indicator regresses.
 */
import { expect, test } from 'bun:test';
import { expectTerminal, withTerminalAsync, type ScreenSnapshot } from 'ghostwright';

const pizza = {
	command: 'bun',
	args: ['src/pizza.ts'],
	cwd: import.meta.dir + '/..',
	viewport: { columns: 80, rows: 24 },
	trace: 'off' as const,
};

const FOCUSED_BORDER = '255,255,255', // WHITE in src/pizza.ts
	UNFOCUSED_BORDER = '100,100,100'; // GRAY in src/pizza.ts

const rgb = (color: any): string =>
	color?.kind === 'rgb' ? `${color.red},${color.green},${color.blue}` : `non-rgb:${color?.kind}`;

interface FieldBox {
	top: ScreenSnapshot['lines'][number];
	bottom: ScreenSnapshot['lines'][number];
}

/**
 * Locate a labelled field's box by walking down from its label row, rather
 * than hardcoding row numbers, so the test survives layout changes above it.
 *
 * Returns undefined when the form has not been painted yet. Predicates passed
 * to `toSatisfy` are evaluated against every revision, including the blank
 * frames before first paint, so they must be total rather than throwing.
 */
function findField(snapshot: ScreenSnapshot, label: string): FieldBox | undefined {
	const labelRows = snapshot.lines.filter((line) => new RegExp(`│\\s+${label}\\s`).test(line.text));
	if (labelRows.length !== 1) return undefined;
	const labelRow = labelRows[0].row,
		top = snapshot.lines.find((line) => line.row > labelRow && line.text.includes('┌')),
		bottom = snapshot.lines.find((line) => line.row > (top?.row ?? 0) && line.text.includes('└'));
	return top && bottom ? { top, bottom } : undefined;
}

/** Same lookup, but for use after the screen has settled, where absence is a bug. */
function requireField(snapshot: ScreenSnapshot, label: string): FieldBox {
	const field = findField(snapshot, label);
	if (!field) expect.unreachable(`could not locate the "${label}" field box on a settled screen`);
	return field;
}

/**
 * A field's box corners are unique to that box: the surrounding panel's own
 * corners live on different rows, so sampling `┌ ┐ └ ┘` isolates this field.
 */
function borderColours(snapshot: ScreenSnapshot, label: string): Set<string> | undefined {
	const field = findField(snapshot, label);
	if (!field) return undefined;
	return new Set(
		[...field.top.cells, ...field.bottom.cells]
			.filter((cell) => /[┌┐└┘]/.test(cell.text))
			.map((cell) => rgb(cell.style.foreground)),
	);
}

const isFocused = (snapshot: ScreenSnapshot, label: string): boolean => {
	const colours = borderColours(snapshot, label);
	return colours?.size === 1 && colours.has(FOCUSED_BORDER);
};

const isUnfocused = (snapshot: ScreenSnapshot, label: string): boolean =>
	borderColours(snapshot, label)?.has(UNFOCUSED_BORDER) === true;

/** True when the terminal cursor (the focused field's caret) is inside the box. */
function cursorInside(snapshot: ScreenSnapshot, label: string): boolean {
	const { top, bottom } = requireField(snapshot, label);
	return snapshot.cursor.row > top.row && snapshot.cursor.row < bottom.row;
}

test('Tab moves focus from the first text field to the second', async () => {
	await withTerminalAsync(pizza, async (terminal) => {
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBePresent();

		// useFocus() seeds focus on the first focusable control, so "Name" is
		// focused on startup without any input.
		const initial = await expectTerminal(terminal).toSatisfy(
			(snapshot) => isFocused(snapshot, 'Name') && isUnfocused(snapshot, 'Address'),
			{ settleMs: 150 },
		);
		expect(cursorInside(initial, 'Name')).toBe(true);
		expect(cursorInside(initial, 'Address')).toBe(false);

		await terminal.keyboard.press('Tab');

		// Focus advances to "Address": its border becomes white, "Name" goes gray,
		// and the caret moves into the second box.
		const afterTab = await expectTerminal(terminal).toSatisfy(
			(snapshot) => isFocused(snapshot, 'Address') && isUnfocused(snapshot, 'Name'),
			{ settleMs: 150 },
		);
		expect(cursorInside(afterTab, 'Address')).toBe(true);
		expect(cursorInside(afterTab, 'Name')).toBe(false);

		// Focus moved rather than merely being added somewhere.
		expect(afterTab.cursor.row).toBeGreaterThan(initial.cursor.row);
	});
});

test('Backtab returns focus to the first text field', async () => {
	await withTerminalAsync(pizza, async (terminal) => {
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBePresent();
		await expectTerminal(terminal).toSatisfy((s) => isFocused(s, 'Name'), { settleMs: 150 });

		await terminal.keyboard.press('Tab');
		await expectTerminal(terminal).toSatisfy((s) => isFocused(s, 'Address'), { settleMs: 150 });

		await terminal.keyboard.press({ key: 'Tab', shift: true });
		const back = await expectTerminal(terminal).toSatisfy(
			(snapshot) => isFocused(snapshot, 'Name') && isUnfocused(snapshot, 'Address'),
			{ settleMs: 150 },
		);
		expect(cursorInside(back, 'Name')).toBe(true);
	});
});

test('typing lands in the focused field, and Tab carries focus past it', async () => {
	await withTerminalAsync(pizza, async (terminal) => {
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBePresent();
		await expectTerminal(terminal).toSatisfy((s) => isFocused(s, 'Name'), { settleMs: 150 });

		await terminal.keyboard.type('Ada');
		await expectTerminal(terminal.getByText('Ada')).toBeStable();

		await terminal.keyboard.press('Tab');
		const afterTab = await expectTerminal(terminal).toSatisfy(
			(snapshot) => isFocused(snapshot, 'Address') && isUnfocused(snapshot, 'Name'),
			{ settleMs: 150 },
		);

		// The typed value stays visible in the now-unfocused first field.
		expect(afterTab.lines.some((line) => line.text.includes('Ada'))).toBe(true);
	});
});

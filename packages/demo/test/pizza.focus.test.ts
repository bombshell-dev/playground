/**
 * Acceptance: keyboard focus traversal between the pizza form's text fields.
 *
 * Focus is asserted purely from visible terminal state, with no application
 * instrumentation. pizza.ts expresses text-field focus two independent ways
 * (see makeField in src/pizza.ts):
 *
 *   1. the field's box border is drawn WHITE when focused and GRAY otherwise
 *   2. only the focused field renders a caret, so the terminal cursor sits
 *      inside that field's box
 *
 * Both are checked, so the tests fail if either indicator regresses.
 */
import { expect, test } from 'bun:test';
import { cellsMatchStyle, expectTerminal, withTerminalAsync } from 'ghostwright';
import type { AsyncTerminal, Rect, ScreenSnapshot, StyleQuery } from 'ghostwright';

const pizza = {
	command: 'bun',
	args: ['src/pizza.ts'],
	cwd: import.meta.dir + '/..',
	viewport: { columns: 80, rows: 24 },
	trace: 'off' as const,
};

const FOCUSED = { foreground: 'rgb(255,255,255)' }, // WHITE in src/pizza.ts
	UNFOCUSED = { foreground: 'rgb(100,100,100)' }; // GRAY in src/pizza.ts

interface FocusProbe {
	/** True when the field's border is drawn entirely in `style`. */
	hasBorder(label: string, style: StyleQuery): boolean;
	/** True when the terminal cursor (the focused field's caret) is inside the box. */
	cursorInBox(snapshot: ScreenSnapshot, label: string): boolean;
}

/**
 * Focus probes bound to one terminal. Bundled into a factory so each helper
 * closes over the session instead of taking it as a parameter.
 */
function focusProbe(terminal: AsyncTerminal): FocusProbe {
	/**
	 * The box drawn under a field's label. Located from the label's own match
	 * geometry rather than hardcoded rows, so layout changes above it are fine.
	 */
	const fieldBox = (label: string): Rect | undefined => {
		const [match] = terminal.getByText(label).matches();
		if (!match) return undefined;
		const snapshot = terminal.screen.snapshot(),
			top = snapshot.lines.find(
				(line) => line.row > match.range.row && line.text.includes('┌'),
			)?.row,
			bottom = snapshot.lines.find((line) => line.row > (top ?? 0) && line.text.includes('└'))?.row;
		if (top === undefined || bottom === undefined) return undefined;
		const columns = snapshot.lines[top].cells.flatMap((cell) =>
			/[┌┐]/.test(cell.text) ? [cell.column] : [],
		);
		if (columns.length < 2) return undefined;
		return {
			column: columns[0],
			row: top,
			width: columns.at(-1)! - columns[0] + 1,
			height: bottom - top + 1,
		};
	};

	return {
		hasBorder(label: string, style: StyleQuery): boolean {
			const box = fieldBox(label);
			if (!box) return false;
			return cellsMatchStyle(
				terminal.screen.getCells(box).filter((cell) => /[┌┐└┘─│]/.test(cell.text)),
				style,
			);
		},
		cursorInBox(snapshot: ScreenSnapshot, label: string): boolean {
			const box = fieldBox(label);
			if (!box) return false;
			return snapshot.cursor.row > box.row && snapshot.cursor.row < box.row + box.height - 1;
		},
	};
}

test('Tab moves focus from the first text field to the second', async () => {
	await withTerminalAsync(pizza, async (terminal) => {
		const { hasBorder, cursorInBox } = focusProbe(terminal);
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBePresent();

		// useFocus() seeds focus on the first focusable control, so "Name" is
		// focused on startup without any input.
		const initial = await expectTerminal(terminal).toSatisfy(
			() => hasBorder('Name', FOCUSED) && hasBorder('Address', UNFOCUSED),
			{ settleMs: 150 },
		);
		expect(cursorInBox(initial, 'Name')).toBe(true);
		expect(cursorInBox(initial, 'Address')).toBe(false);

		await terminal.keyboard.press('Tab');

		// Focus advances to "Address": its border turns white, "Name" goes gray,
		// and the caret moves into the second box.
		const afterTab = await expectTerminal(terminal).toSatisfy(
			() => hasBorder('Address', FOCUSED) && hasBorder('Name', UNFOCUSED),
			{ settleMs: 150 },
		);
		expect(cursorInBox(afterTab, 'Address')).toBe(true);
		expect(cursorInBox(afterTab, 'Name')).toBe(false);

		// Focus moved rather than merely being added somewhere.
		expect(afterTab.cursor.row).toBeGreaterThan(initial.cursor.row);
	});
});

test('Backtab returns focus to the first text field', async () => {
	await withTerminalAsync(pizza, async (terminal) => {
		const { hasBorder, cursorInBox } = focusProbe(terminal);
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBePresent();
		await expectTerminal(terminal).toSatisfy(() => hasBorder('Name', FOCUSED), {
			settleMs: 150,
		});

		await terminal.keyboard.press('Tab');
		await expectTerminal(terminal).toSatisfy(() => hasBorder('Address', FOCUSED), {
			settleMs: 150,
		});

		await terminal.keyboard.press('Shift+Tab');
		const back = await expectTerminal(terminal).toSatisfy(
			() => hasBorder('Name', FOCUSED) && hasBorder('Address', UNFOCUSED),
			{ settleMs: 150 },
		);
		expect(cursorInBox(back, 'Name')).toBe(true);
	});
});

test('typing lands in the focused field, and Tab carries focus past it', async () => {
	await withTerminalAsync(pizza, async (terminal) => {
		const { hasBorder } = focusProbe(terminal);
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBePresent();
		await expectTerminal(terminal).toSatisfy(() => hasBorder('Name', FOCUSED), {
			settleMs: 150,
		});

		await terminal.keyboard.type('Ada');
		await expectTerminal(terminal.getByText('Ada')).toBeStable();

		await terminal.keyboard.press('Tab');
		await expectTerminal(terminal).toSatisfy(
			() => hasBorder('Address', FOCUSED) && hasBorder('Name', UNFOCUSED),
			{ settleMs: 150 },
		);

		// The typed value stays visible in the now-unfocused first field.
		await expectTerminal(terminal.getByText('Ada')).toBePresent();
	});
});

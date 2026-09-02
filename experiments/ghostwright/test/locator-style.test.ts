import { expect, test } from 'bun:test';
import {
	DEFAULT_ASSERTION_TIMEOUT_MS,
	expectTerminal,
	InvalidKeyError,
	TerminalAssertionError,
	withTerminalAsync,
} from '../src/index.ts';

/** Emits red "ALERT", plain "READY", then parks the cursor on a known cell. */
const coloured = {
	command: '/bin/sh',
	args: [
		'-c',
		`printf '\\033[38;2;255;0;0mALERT\\033[0m\\r\\nREADY\\r\\n'; printf '\\033[1;1H'; sleep 30`,
	],
	viewport: { columns: 40, rows: 6 },
	trace: 'off' as const,
};

test('toHaveStyle matches a foreground colour', async () => {
	await withTerminalAsync(coloured, async (terminal) => {
		await expectTerminal(terminal.getByText('ALERT')).toHaveStyle({ foreground: 'rgb(255,0,0)' });
		await expectTerminal(terminal.getByText('ALERT')).toHaveStyle({ foreground: '#ff0000' });
	});
});

test('toHaveStyle fails when the colour differs', async () => {
	await withTerminalAsync(coloured, async (terminal) => {
		await expectTerminal(terminal.getByText('READY')).toBePresent();
		let error: unknown;
		try {
			await expectTerminal(terminal.getByText('READY')).toHaveStyle(
				{ foreground: 'rgb(255,0,0)' },
				{ timeoutMs: 400 },
			);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(TerminalAssertionError);
		// The diagnostic reports what the style actually was.
		expect((error as Error).message).toContain('actual style:');
		expect((error as Error).message).toContain('foreground=');
	});
});

test('style-filtered locators disambiguate identical text', async () => {
	await withTerminalAsync(
		{
			command: '/bin/sh',
			args: ['-c', `printf '\\033[38;2;255;0;0mSAVE\\033[0m\\r\\nSAVE\\r\\n'; sleep 30`],
			viewport: { columns: 40, rows: 6 },
			trace: 'off' as const,
		},
		async (terminal) => {
			// Unfiltered the locator is ambiguous; the colour filter makes it unique.
			const red = terminal.getByText('SAVE', { style: { foreground: 'rgb(255,0,0)' } });
			const match = await expectTerminal(red).toBePresent();
			expect(match.range.row).toBe(0);
			expect(terminal.getByText('SAVE').matches().length).toBe(2);
			expect(red.matches().length).toBe(1);
		},
	);
});

test('toContainCursor tracks where the terminal cursor sits', async () => {
	await withTerminalAsync(coloured, async (terminal) => {
		// The trailing escape parks the cursor at row 0, column 0, inside "ALERT".
		await expectTerminal(terminal.getByText('ALERT')).toContainCursor();

		let error: unknown;
		try {
			await expectTerminal(terminal.getByText('READY')).toContainCursor({ timeoutMs: 400 });
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(TerminalAssertionError);
		expect((error as Error).message).toContain('to contain the cursor');
	});
});

test('locator matches expose their backing cells', async () => {
	await withTerminalAsync(coloured, async (terminal) => {
		const match = await expectTerminal(terminal.getByText('ALERT')).toBePresent();
		expect(match.cells.length).toBe(5);
		expect(match.cells.map((cell) => cell.text).join('')).toBe('ALERT');
		expect(match.cells[0].style.foreground).toEqual({ kind: 'rgb', red: 255, green: 0, blue: 0 });
	});
});

test('screen.getCells returns a rectangle of cells', async () => {
	await withTerminalAsync(coloured, async (terminal) => {
		await expectTerminal(terminal.getByText('READY')).toBePresent();
		const cells = terminal.screen.getCells({ column: 0, row: 0, width: 5, height: 1 });
		expect(cells.map((cell) => cell.text).join('')).toBe('ALERT');
		expect(terminal.screen.getCells({ column: 0, row: 0, width: 5, height: 2 }).length).toBe(10);
	});
});

test('screen.snapshot aliases screen.current', async () => {
	await withTerminalAsync(coloured, async (terminal) => {
		await expectTerminal(terminal.getByText('READY')).toBePresent();
		expect(terminal.screen.snapshot()).toBe(terminal.screen.current());
	});
});

test('a throwing predicate counts as unsatisfied and is reported', async () => {
	// oxlint-disable bombshell-dev/no-generic-error -- throwing a plain Error is the behaviour under test
	await withTerminalAsync(coloured, async (terminal) => {
		// Converges even though early revisions make the predicate throw.
		await expectTerminal(terminal).toSatisfy((snapshot) => {
			if (!snapshot.lines.some((line) => line.text.includes('READY')))
				throw new Error('not painted yet');
			return true;
		});

		let error: unknown;
		try {
			await expectTerminal(terminal).toSatisfy(
				() => {
					throw new Error('always broken');
				},
				{ timeoutMs: 400 },
			);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(TerminalAssertionError);
		expect((error as Error).message).toContain('predicate threw');
		expect((error as Error).message).toContain('always broken');
	});
	// oxlint-enable bombshell-dev/no-generic-error
});

test('unknown key names fail fast instead of timing out', async () => {
	await withTerminalAsync(coloured, async (terminal) => {
		await expectTerminal(terminal.getByText('READY')).toBePresent();
		expect(terminal.keyboard.press('Retrun')).rejects.toBeInstanceOf(InvalidKeyError);
	});
});

test('modifier combinations are accepted by press', async () => {
	await withTerminalAsync(coloured, async (terminal) => {
		await expectTerminal(terminal.getByText('READY')).toBePresent();
		// Shift+Tab used to encode nothing at all and surface as a timeout.
		const receipt = await terminal.keyboard.press('Shift+Tab');
		expect(receipt.bytesWritten).toBeGreaterThan(0);
	});
});

test('the default assertion timeout stays below common runner defaults', () => {
	expect(DEFAULT_ASSERTION_TIMEOUT_MS).toBeLessThan(5000);
});

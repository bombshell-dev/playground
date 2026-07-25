import { expect, test } from 'bun:test';
import {
	expectTerminal,
	withTerminalAsync,
	type AsyncTerminal,
	type Rect,
	type TerminalLaunchOptions,
} from 'ghostwright';
import { ClayMetadataExtension } from './support/clay-metadata-extension.ts';

type GeometryMode = 'offset' | 'fractional' | 'clipped' | 'offscreen';

const app = (mode: GeometryMode): TerminalLaunchOptions => ({
	command: 'bun',
	args: ['src/clay-geometry-spike.ts', mode],
	cwd: import.meta.dir + '/..',
	viewport: { columns: 30, rows: 20 },
	trace: 'off' as const,
});

function colourBounds(
	terminal: AsyncTerminal,
	colour: { red: number; green: number; blue: number },
): Rect | undefined {
	const points = terminal.screen
		.snapshot()
		.lines.flatMap((line) =>
			line.cells
				.filter(
					(cell) =>
						cell.style.background.kind === 'rgb' &&
						cell.style.background.red === colour.red &&
						cell.style.background.green === colour.green &&
						cell.style.background.blue === colour.blue,
				)
				.map((cell) => ({ column: cell.column, row: line.row })),
		);
	if (points.length === 0) return undefined;
	const columns = points.map((point) => point.column),
		rows = points.map((point) => point.row),
		left = Math.min(...columns),
		right = Math.max(...columns),
		top = Math.min(...rows),
		bottom = Math.max(...rows);
	return { column: left, row: top, width: right - left + 1, height: bottom - top + 1 };
}

test('RenderOptions.row shifts visible cells but not Clay layout bounds', async () => {
	await withTerminalAsync(app('offset'), async (terminal) => {
		const clay = new ClayMetadataExtension(terminal);
		await expectTerminal(terminal).toSatisfy(
			() =>
				clay.current()?.mode === 'offset' &&
				terminal.screen.getCell({ column: 5, row: 6 }).text === '┌',
		);
		const frame = clay.current(),
			target = clay.getById('offset-target');

		expect(frame?.renderSurface).toEqual({ width: 20, height: 5, row: 6 });
		expect(target?.bounds).toEqual({ column: 5, row: 1, width: 10, height: 3 });

		// Clay reports coordinates local to its 20x5 render surface. The actual
		// terminal rows are shifted by the 1-based RenderOptions.row origin.
		expect(terminal.screen.getText(target!.bounds)).not.toContain('┌');
		const terminalBounds = {
			...target!.bounds,
			row: target!.bounds.row + frame!.renderSurface!.row - 1,
		};
		expect(terminal.screen.getText(terminalBounds)).toContain('┌');
		expect(
			terminal.screen.getCell({ column: terminalBounds.column, row: terminalBounds.row }).text,
		).toBe('┌');
	});
});

test('fractional Clay coordinates are rasterized by truncating their edges', async () => {
	await withTerminalAsync(app('fractional'), async (terminal) => {
		const clay = new ClayMetadataExtension(terminal);
		await expectTerminal(terminal).toSatisfy(
			() =>
				clay.current()?.mode === 'fractional' &&
				colourBounds(terminal, { red: 0, green: 255, blue: 0 }) !== undefined,
		);
		const target = clay.getById('fractional-target'),
			visible = colourBounds(terminal, { red: 0, green: 255, blue: 0 });

		// Centering an odd 5x3 rectangle in an even 20x10 surface yields half-cell
		// Clay coordinates. clayterm.c casts each edge to int before painting.
		expect(target?.metadata.rect).toEqual([7.5, 3.5, 5, 3]);
		expect(visible).toEqual({ column: 7, row: 3, width: 5, height: 3 });
		expect(target?.bounds).toEqual(visible);
	});
});

test('Clay layout bounds remain oversized while clipping reduces visible bounds', async () => {
	await withTerminalAsync(app('clipped'), async (terminal) => {
		const clay = new ClayMetadataExtension(terminal);
		await expectTerminal(terminal).toSatisfy(
			() =>
				clay.current()?.mode === 'clipped' &&
				colourBounds(terminal, { red: 255, green: 0, blue: 0 }) !== undefined,
		);
		const clipper = clay.getById('clipper'),
			target = clay.getById('oversized-target'),
			visible = colourBounds(terminal, { red: 255, green: 0, blue: 0 });

		expect(clipper?.bounds).toEqual({ column: 9, row: 2, width: 12, height: 5 });
		expect(target?.bounds).toEqual({ column: 9, row: 2, width: 20, height: 7 });
		expect(visible).toEqual(clipper?.bounds);
		expect(visible?.width).toBeLessThan(target!.bounds.width);
		expect(visible?.height).toBeLessThan(target!.bounds.height);
	});
});

test('viewport intersection clips negative and oversized layout bounds', async () => {
	await withTerminalAsync(app('offscreen'), async (terminal) => {
		const clay = new ClayMetadataExtension(terminal);
		await expectTerminal(terminal).toSatisfy(
			() =>
				clay.current()?.mode === 'offscreen' &&
				colourBounds(terminal, { red: 0, green: 0, blue: 255 }) !== undefined,
		);
		const target = clay.getById('offscreen-target'),
			visible = colourBounds(terminal, { red: 0, green: 0, blue: 255 });

		// The centered 40-cell element extends five cells beyond each side of a
		// 30-cell surface. Clay retains its logical box; clayterm's viewport clips
		// cell writes to columns 0..29.
		expect(target?.metadata.rect).toEqual([-5, 3.5, 40, 3]);
		expect(visible).toEqual({ column: 0, row: 3, width: 30, height: 3 });
		expect(target?.bounds.column).toBe(-5);
		expect(target?.bounds.width).toBe(40);
	});
});

import { expect, test } from 'bun:test';
import {
	defineScreenLocator,
	type Observation,
	type ScreenSnapshot,
	type RegionInspection,
	type Rect,
} from '../src/index.ts';
import { GhosttyWasmTerminal } from '../src/terminal/wasm.ts';

function observation(screen: ScreenSnapshot): Observation {
	return { kind: 'screen', screen, sequence: screen.sequence, timestamp: screen.timestamp };
}

test('a screen locator re-resolves geometry while historical matches keep their own cells', async () => {
	const marks = defineScreenLocator('visible x cells', (screen) =>
		screen.lines.flatMap((line) =>
			line.cells
				.filter((cell) => cell.text === 'x' && !cell.style.invisible)
				.map((cell) => ({ column: cell.column, row: line.row, width: 1, height: 1 })),
		),
	);
	const terminal = await GhosttyWasmTerminal.create({
		columns: 20,
		rows: 4,
		widthPixels: 200,
		heightPixels: 80,
	});
	try {
		terminal.write(Buffer.from('xAxB'));
		const before = observation(terminal.snapshot());
		terminal.write(Buffer.from('\x1b[2J\x1b[3;8HxC'));
		const after = observation(terminal.snapshot());

		expect(marks.resolve(before).map((region) => region.bounds.column)).toEqual([0, 2]);
		expect(marks.nth(1).resolve(before)[0]!.text()).toBe('x');
		expect(marks.resolve(after)[0]!.bounds).toEqual({ column: 7, row: 2, width: 1, height: 1 });
		expect(marks.resolve(before)[0]!.bounds.column).toBe(0);
		expect(marks.nth(1).resolve(after)).toEqual([]);

		// The resolver defines the relationship. Here the child is the next
		// cell, not a cell geometrically contained by its parent.
		const nextCell = (parent: RegionInspection): Rect[] => [
			{ ...parent.bounds, column: parent.bounds.column + 1 },
		];
		const letters = marks.derive('next cell', nextCell);
		expect(letters.resolve(before).map((region) => region.text())).toEqual(['A', 'B']);
		expect(letters.nth(1).resolve(before)[0]!.text()).toBe('B');
		expect(marks.nth(1).derive('next cell', nextCell).resolve(before)[0]!.text()).toBe('B');
		expect(letters.resolve(after).map((region) => region.text())).toEqual(['C']);
	} finally {
		terminal.free();
	}
});

test('screen-derived geometry crosses the same validation boundary as described geometry', async () => {
	const invalid = defineScreenLocator('invalid region', () => [
		{ column: 0, row: 0, width: -1, height: 1 },
	]);
	const terminal = await GhosttyWasmTerminal.create({
		columns: 20,
		rows: 4,
		widthPixels: 200,
		heightPixels: 80,
	});
	try {
		expect(() => invalid.resolve(observation(terminal.snapshot()))).toThrow(
			'Region requires integer coordinates and nonnegative dimensions',
		);
	} finally {
		terminal.free();
	}
});

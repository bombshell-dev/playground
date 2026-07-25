import { expect, test } from 'bun:test';
import { geometryFor } from '../src/producer.ts';

test('geometry omits visible bounds until tty supplies authoritative clipping', () => {
	const geometry = geometryFor(
		{ x: -2.5, y: 3.5, width: 20, height: 4 },
		{ columns: 10, rows: 8 },
	);
	expect(geometry.terminalBounds).toEqual({ column: -2, row: 3, width: 19, height: 4 });
	expect(geometry.visibleBounds).toBeUndefined();
});

test('geometry intersects authoritative clipping with terminal and viewport bounds', () => {
	const geometry = geometryFor(
		{ x: -2.5, y: 3.5, width: 20, height: 4 },
		{ columns: 10, rows: 8 },
		{ column: 2, row: 4, width: 20, height: 10 },
	);
	expect(geometry.visibleBounds).toEqual({ column: 2, row: 4, width: 8, height: 3 });
});

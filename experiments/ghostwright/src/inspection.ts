import { CoordinateRangeError } from './errors.ts';
import type { Rect, ScreenCell, ScreenSnapshot } from './types.ts';

export type Edge = 'top' | 'bottom' | 'left' | 'right';
export function intersect(a: Rect, b: Rect): Rect | undefined {
	const column = Math.max(a.column, b.column),
		row = Math.max(a.row, b.row);
	const width = Math.min(a.column + a.width, b.column + b.width) - column;
	const height = Math.min(a.row + a.height, b.row + b.height) - row;
	return width > 0 && height > 0 ? Object.freeze({ column, row, width, height }) : undefined;
}
export function validateBounds(bounds: Rect): void {
	if (
		![bounds.column, bounds.row, bounds.width, bounds.height].every(Number.isSafeInteger) ||
		bounds.width < 0 ||
		bounds.height < 0
	)
		throw new CoordinateRangeError(
			'Region requires integer coordinates and nonnegative dimensions',
		);
}

/** A view over one immutable snapshot. Bounds remain unclipped; cells are viewport-clipped. */
export class RegionInspection {
	readonly bounds: Readonly<Rect>;
	readonly visibleBounds: Readonly<Rect> | undefined;
	readonly screen: ScreenSnapshot;
	constructor(screen: ScreenSnapshot, bounds: Rect) {
		this.screen = screen;
		validateBounds(bounds);
		this.bounds = Object.freeze({ ...bounds });
		this.visibleBounds = intersect(bounds, {
			column: 0,
			row: 0,
			width: screen.viewport.columns,
			height: screen.viewport.rows,
		});
		Object.freeze(this);
	}
	cells(): readonly ScreenCell[] {
		const r = this.visibleBounds;
		return Object.freeze(
			r
				? this.screen.lines
						.slice(r.row, r.row + r.height)
						.flatMap((line) => line.cells.slice(r.column, r.column + r.width))
				: [],
		);
	}
	text(): string {
		const r = this.visibleBounds;
		return r
			? this.screen.lines
					.slice(r.row, r.row + r.height)
					.map((line) =>
						line.cells
							.slice(r.column, r.column + r.width)
							.map((cell) =>
								cell.continuation ? '' : cell.style.invisible ? ' ' : cell.text || ' ',
							)
							.join(''),
					)
					.join('\n')
			: '';
	}
	edge(edge: Edge): RegionInspection {
		const r = this.bounds;
		return new RegionInspection(
			this.screen,
			edge === 'top' || edge === 'bottom'
				? {
						column: r.column,
						row: edge === 'top' ? r.row : r.row + r.height - 1,
						width: r.width,
						height: r.height ? 1 : 0,
					}
				: {
						column: edge === 'left' ? r.column : r.column + r.width - 1,
						row: r.row,
						width: r.width ? 1 : 0,
						height: r.height,
					},
		);
	}
	cursor(): Readonly<ScreenSnapshot['cursor'] & { inside: boolean }> {
		const cursor = this.screen.cursor,
			r = this.visibleBounds;
		return Object.freeze({
			...cursor,
			inside:
				!!r &&
				cursor.column >= r.column &&
				cursor.column < r.column + r.width &&
				cursor.row >= r.row &&
				cursor.row < r.row + r.height,
		});
	}
	/** Region-relative contents. Movement is a separate geometry condition. */
	visualKey(): string {
		const cursor = this.cursor();
		return JSON.stringify([
			this.bounds.width,
			this.bounds.height,
			this.cells().map((c) => [c.text, c.width, c.style]),
			cursor.inside && cursor.visible
				? [cursor.column - this.bounds.column, cursor.row - this.bounds.row, cursor.shape]
				: null,
		]);
	}
}
export function inspect(
	screen: ScreenSnapshot,
): Readonly<{ region(bounds: Rect): RegionInspection }> {
	return Object.freeze({ region: (bounds: Rect) => new RegionInspection(screen, bounds) });
}

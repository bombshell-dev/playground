import type {
	LocatorMatch,
	Rect,
	ScreenCell,
	ScreenSnapshot,
	TextLocatorOptions,
} from '../types.ts';
import { cellsMatchStyle } from '../styles.ts';

/** Match rendered text once. Both query APIs use these cell-aware ranges. */
// oxlint-disable-next-line bombshell-dev/max-params -- immutable screen, search, style, and optional bounds
export function findText(
	screen: ScreenSnapshot,
	text: string,
	options: TextLocatorOptions = {},
	bounds?: Rect,
): readonly LocatorMatch[] {
	const matches: LocatorMatch[] = [];
	for (const line of screen.lines) {
		if (bounds && (line.row < bounds.row || line.row >= bounds.row + bounds.height)) continue;
		const start = bounds?.column ?? 0;
		const end = bounds ? bounds.column + bounds.width : screen.viewport.columns;
		const segments: { start: number; end: number; cell: ScreenCell }[] = [];
		let row = '';
		for (const cell of line.cells.slice(start, end)) {
			if (cell.continuation) continue;
			const part = cell.style.invisible ? ' ' : cell.text || ' ';
			const offset = row.length;
			row += part;
			segments.push({ start: offset, end: row.length, cell });
		}
		const add = (from: number, to: number): void => {
			const cells = segments
				.filter((segment) => from < segment.end && to > segment.start)
				.map((segment) => segment.cell);
			if (options.style && !cellsMatchStyle(cells, options.style)) return;
			const first = cells[0];
			const last = cells.at(-1) ?? first;
			const column = first?.column ?? start;
			const right = last ? last.column + Math.max(1, last.width) : column + 1;
			matches.push({
				text: row.slice(from, to),
				rowText: row,
				range: { column, row: line.row, width: Math.max(1, right - column), height: 1 },
				cells: Object.freeze(cells),
			});
		};
		if (options.exact) {
			const trimmed = row.replace(/ +$/g, '');
			if (trimmed === text) add(0, trimmed.length);
		} else {
			let at = 0;
			while (text.length && (at = row.indexOf(text, at)) >= 0) {
				add(at, at + text.length);
				at += text.length;
			}
		}
	}
	return Object.freeze(matches);
}

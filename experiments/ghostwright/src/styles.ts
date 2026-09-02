import type { CellStyle, ColorQuery, ScreenCell, StyleQuery, TerminalColor } from './types.ts';

function parseColor(query: ColorQuery): TerminalColor | undefined {
	if (typeof query !== 'string') return query;
	const text = query.trim().toLowerCase();
	if (text === 'default') return { kind: 'default' };
	const palette = /^palette:(\d+)$/.exec(text);
	if (palette) return { kind: 'palette', index: Number(palette[1]) };
	const hex = /^#?([0-9a-f]{6})$/.exec(text);
	if (hex)
		return {
			kind: 'rgb',
			red: Number.parseInt(hex[1].slice(0, 2), 16),
			green: Number.parseInt(hex[1].slice(2, 4), 16),
			blue: Number.parseInt(hex[1].slice(4, 6), 16),
		};
	const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(text);
	if (rgb) return { kind: 'rgb', red: Number(rgb[1]), green: Number(rgb[2]), blue: Number(rgb[3]) };
	return undefined;
}

function colorMatches(actual: TerminalColor | undefined, query: ColorQuery): boolean {
	const expected = parseColor(query);
	if (!expected || !actual) return false;
	if (expected.kind !== actual.kind) return false;
	if (expected.kind === 'palette' && actual.kind === 'palette')
		return expected.index === actual.index;
	if (expected.kind === 'rgb' && actual.kind === 'rgb')
		return (
			expected.red === actual.red &&
			expected.green === actual.green &&
			expected.blue === actual.blue
		);
	return true;
}

/** True when `style` satisfies every field named in `query`. */
export function styleMatches(style: CellStyle, query: StyleQuery): boolean {
	for (const [key, expected] of Object.entries(query)) {
		if (expected === undefined) continue;
		if (key === 'foreground' || key === 'background') {
			if (!colorMatches(style[key], expected as ColorQuery)) return false;
			continue;
		}
		if (style[key as keyof CellStyle] !== expected) return false;
	}
	return true;
}

/** True when every non-continuation cell satisfies `query`. */
export function cellsMatchStyle(cells: readonly ScreenCell[], query: StyleQuery): boolean {
	const relevant = cells.filter((cell) => !cell.continuation);
	return relevant.length > 0 && relevant.every((cell) => styleMatches(cell.style, query));
}

/** Human-readable colour, for assertion diagnostics. */
export function describeColor(color: TerminalColor | undefined): string {
	if (!color) return 'none';
	if (color.kind === 'rgb') return `rgb(${color.red},${color.green},${color.blue})`;
	if (color.kind === 'palette') return `palette:${color.index}`;
	return 'default';
}

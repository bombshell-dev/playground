import { expect, test } from 'bun:test';
import { cellsMatchStyle, describeColor, styleMatches } from '../src/index.ts';
import type { CellStyle, ScreenCell } from '../src/index.ts';

const style = (overrides: Partial<CellStyle> = {}): CellStyle => ({
	bold: false,
	italic: false,
	faint: false,
	blink: false,
	inverse: false,
	invisible: false,
	strikethrough: false,
	overline: false,
	underline: 0,
	foreground: { kind: 'rgb', red: 255, green: 255, blue: 255 },
	background: { kind: 'default' },
	...overrides,
});

const cell = (overrides: Partial<ScreenCell> = {}): ScreenCell => ({
	column: 0,
	text: 'x',
	width: 1,
	continuation: false,
	style: style(),
	selected: false,
	...overrides,
});

test('styleMatches ignores fields the query omits', () => {
	expect(styleMatches(style({ bold: true }), {})).toBe(true);
	expect(styleMatches(style({ bold: true }), { bold: true })).toBe(true);
	expect(styleMatches(style({ bold: true }), { bold: false })).toBe(false);
});

test('styleMatches compares boolean and numeric attributes', () => {
	expect(styleMatches(style({ inverse: true }), { inverse: true })).toBe(true);
	expect(styleMatches(style({ underline: 2 }), { underline: 2 })).toBe(true);
	expect(styleMatches(style({ underline: 2 }), { underline: 1 })).toBe(false);
});

test('styleMatches accepts structured colours', () => {
	expect(
		styleMatches(style(), { foreground: { kind: 'rgb', red: 255, green: 255, blue: 255 } }),
	).toBe(true);
	expect(styleMatches(style(), { foreground: { kind: 'rgb', red: 1, green: 2, blue: 3 } })).toBe(
		false,
	);
});

test('styleMatches accepts colour shorthands', () => {
	expect(styleMatches(style(), { foreground: '#ffffff' })).toBe(true);
	expect(styleMatches(style(), { foreground: 'ffffff' })).toBe(true);
	expect(styleMatches(style(), { foreground: 'rgb(255,255,255)' })).toBe(true);
	expect(styleMatches(style(), { foreground: 'rgb(255, 255, 255)' })).toBe(true);
	expect(styleMatches(style(), { foreground: '#000000' })).toBe(false);
	expect(styleMatches(style(), { background: 'default' })).toBe(true);
});

test('styleMatches handles palette colours', () => {
	const paletted = style({ foreground: { kind: 'palette', index: 4 } });
	expect(styleMatches(paletted, { foreground: 'palette:4' })).toBe(true);
	expect(styleMatches(paletted, { foreground: 'palette:5' })).toBe(false);
	expect(styleMatches(paletted, { foreground: '#ffffff' })).toBe(false);
});

test('styleMatches rejects unparseable colour queries rather than matching loosely', () => {
	expect(styleMatches(style(), { foreground: 'chartreuse' })).toBe(false);
});

test('cellsMatchStyle requires every cell to match', () => {
	const white = cell(),
		black = cell({ style: style({ foreground: { kind: 'rgb', red: 0, green: 0, blue: 0 } }) });
	expect(cellsMatchStyle([white, white], { foreground: '#ffffff' })).toBe(true);
	expect(cellsMatchStyle([white, black], { foreground: '#ffffff' })).toBe(false);
});

test('cellsMatchStyle ignores continuation cells but needs at least one real cell', () => {
	const wide = cell({ width: 2 }),
		continuation = cell({ continuation: true, style: style({ bold: true }) });
	expect(cellsMatchStyle([wide, continuation], { bold: false })).toBe(true);
	expect(cellsMatchStyle([continuation], { bold: true })).toBe(false);
	expect(cellsMatchStyle([], { bold: false })).toBe(false);
});

test('describeColor renders each colour kind', () => {
	expect(describeColor({ kind: 'rgb', red: 1, green: 2, blue: 3 })).toBe('rgb(1,2,3)');
	expect(describeColor({ kind: 'palette', index: 7 })).toBe('palette:7');
	expect(describeColor({ kind: 'default' })).toBe('default');
	expect(describeColor(undefined)).toBe('none');
});

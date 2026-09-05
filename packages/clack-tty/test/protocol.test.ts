import { expect, test } from 'vitest';
import {
	decodeFrame,
	encodeFrame,
	geometryFor,
	validateFrame,
	type ClackFrame,
} from '../src/protocol.ts';

const frame = (): ClackFrame => ({
	v: 1,
	frame: 1,
	surface: { columns: 80, rows: 24, row: 1 },
	nodes: [
		{
			key: 'name',
			name: 'input',
			parent: null,
			order: 0,
			attrs: { role: 'textbox', label: 'name' },
			geo: {
				layout: { x: 2, y: 5, width: 10, height: 3 },
				term: { column: 2, row: 5, width: 10, height: 3 },
			},
		},
	],
});

test('identity and geometry round-trip without application focus/value state', () => {
	const encoded = Buffer.from(encodeFrame(frame())).toString();
	expect(encoded.startsWith('\x1b]7777;clack.ui;v=1;')).toBe(true);
	expect(decodeFrame(Buffer.from(encoded.slice('\x1b]7777;clack.ui;v=1;'.length, -2)))).toEqual(
		frame(),
	);
	expect(JSON.stringify(frame())).not.toMatch(/focused|focusStack|caret|value/);
});

for (const [name, mutate] of [
	[
		'version',
		(f: any) => {
			f.v = 9;
		},
	],
	[
		'frame number',
		(f: any) => {
			f.frame = 0;
		},
	],
	[
		'missing parent',
		(f: any) => {
			f.nodes[0].parent = 'absent';
		},
	],
	[
		'parent cycle',
		(f: any) => {
			f.nodes[0].parent = 'name';
		},
	],
	[
		'duplicate key',
		(f: any) => {
			f.nodes.push(f.nodes[0]);
		},
	],
	[
		'negative size',
		(f: any) => {
			f.nodes[0].geo.term.width = -1;
		},
	],
	[
		'fractional cell',
		(f: any) => {
			f.nodes[0].geo.term.column = 1.5;
		},
	],
	[
		'oversized label',
		(f: any) => {
			f.nodes[0].attrs.label = 'x'.repeat(1025);
		},
	],
] as const)
	test(`rejects ${name}`, () => {
		const value = frame();
		mutate(value);
		expect(() => validateFrame(value)).toThrow();
	});

for (const payload of [
	'=',
	'***',
	'a',
	Buffer.from('{').toString('base64url'),
	Buffer.from([0xff]).toString('base64url'),
]) {
	test(`rejects malformed payload ${payload}`, () => {
		expect(() => decodeFrame(Buffer.from(payload))).toThrow();
	});
}

test('geometry keeps original bounds separate from viewport clipping', () => {
	const geometry = geometryFor(
		{ x: -2, y: 5, width: 10, height: 3 },
		{ columns: 80, rows: 24, row: 1 },
	);
	expect(geometry.term).toEqual({ column: -2, row: 5, width: 10, height: 3 });
	expect(geometry.visible).toEqual({ column: 0, row: 5, width: 8, height: 3 });
});

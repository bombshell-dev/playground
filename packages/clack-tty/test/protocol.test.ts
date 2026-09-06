import { expect, test } from 'vitest';
import {
	decodeFrame,
	encodeFrame,
	geometryFor,
	validateFrame,
	type ClackFrame,
	type ClackNode,
} from '../src/protocol.ts';

const input = {
	key: 'name',
	name: 'input',
	parent: null,
	order: 0,
	attrs: { role: 'textbox', label: 'name' },
	geo: {
		layout: { x: 2, y: 5, width: 10, height: 3 },
		term: { column: 2, row: 5, width: 10, height: 3 },
	},
} satisfies ClackNode;

const frame = (): ClackFrame => ({
	v: 1,
	frame: 1,
	surface: { columns: 80, rows: 24, row: 1 },
	nodes: [structuredClone(input)],
});

test('identity and geometry round-trip', () => {
	const encoded = Buffer.from(encodeFrame(frame())).toString();
	expect(encoded.startsWith('\x1b]7777;clack.ui;v=1;')).toBe(true);
	expect(decodeFrame(Buffer.from(encoded.slice('\x1b]7777;clack.ui;v=1;'.length, -2)))).toEqual(
		frame(),
	);
});

test('custom attributes retain names shared with Object.prototype', () => {
	const custom = { ['__proto__']: 'plain', constructor: 'field', toString: null };
	const encoded = Buffer.from(
		encodeFrame({ ...frame(), nodes: [{ ...input, attrs: { custom } }] }),
	).toString();
	const decoded = decodeFrame(Buffer.from(encoded.slice('\x1b]7777;clack.ui;v=1;'.length, -2)));
	expect(decoded.nodes[0]?.attrs.custom).toEqual(custom);
});

// Malformed wire data is intentionally not a ClackFrame. Construct it as
// input to the validator rather than using `any` to mutate a valid typed frame.
for (const [name, value] of [
	['version', { ...frame(), v: 9 }],
	['frame number', { ...frame(), frame: 0 }],
	['non-object surface', { ...frame(), surface: '80x24' }],
	['string surface dimension', { ...frame(), surface: { ...frame().surface, columns: '80' } }],
	['non-string label', { ...frame(), nodes: [{ ...input, attrs: { label: 42 } }] }],
	['non-boolean input flag', { ...frame(), nodes: [{ ...input, attrs: { input: 1 } }] }],
	[
		'non-numeric layout',
		{
			...frame(),
			nodes: [{ ...input, geo: { ...input.geo, layout: { ...input.geo.layout, x: '2' } } }],
		},
	],
	[
		'non-finite layout',
		{
			...frame(),
			nodes: [
				{ ...input, geo: { ...input.geo, layout: { ...input.geo.layout, width: Infinity } } },
			],
		},
	],
	['missing parent', { ...frame(), nodes: [{ ...input, parent: 'absent' }] }],
	['parent cycle', { ...frame(), nodes: [{ ...input, parent: 'name' }] }],
	['duplicate key', { ...frame(), nodes: [input, input] }],
	[
		'negative size',
		{
			...frame(),
			nodes: [{ ...input, geo: { ...input.geo, term: { ...input.geo.term, width: -1 } } }],
		},
	],
	[
		'fractional cell',
		{
			...frame(),
			nodes: [{ ...input, geo: { ...input.geo, term: { ...input.geo.term, column: 1.5 } } }],
		},
	],
	[
		'oversized label',
		{ ...frame(), nodes: [{ ...input, attrs: { ...input.attrs, label: 'x'.repeat(1025) } }] },
	],
] as const) {
	test(`rejects ${name}`, () => {
		expect(() => validateFrame(value)).toThrow();
	});
}

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

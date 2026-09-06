import { expect, expectTypeOf, test } from 'vitest';
import {
	textContains,
	withTerminalAsync,
	type Observation,
	type RegionLocator,
	type TerminalLaunchOptions,
} from 'ghostwright';
import { clackTtyExtension, locator, type ClackLocator } from '../src/index.ts';
import {
	encodeFrame,
	type ClackFrame,
	type ClackNode,
	type ClackNodeGeometry,
} from '../src/protocol.ts';

const geo = ({
	column,
	row,
	width,
}: {
	column: number;
	row: number;
	width: number;
}): ClackNodeGeometry => ({
	layout: { x: column, y: row, width, height: 1 },
	term: { column, row, width, height: 1 },
});

function scene({
	frame,
	text,
	column,
	parentKey,
}: {
	frame: number;
	text: string;
	column: number;
	parentKey: string | null;
}): string {
	const nodes: ClackNode[] = [];
	if (parentKey)
		nodes.push(
			{
				key: parentKey,
				name: 'form',
				parent: null,
				order: 0,
				attrs: { label: 'delivery' },
				geo: geo({ column: 0, row: 0, width: 6 }),
			},
			// This structural container deliberately has no painted geometry.
			{ key: 'fields', name: 'box', parent: parentKey, order: 0, attrs: { label: 'fields' } },
			{
				key: 'name',
				name: 'input',
				parent: 'fields',
				order: 0,
				attrs: { label: 'name' },
				geo: geo({ column, row: 1, width: 8 }),
			},
			{
				key: 'address',
				name: 'input',
				parent: 'fields',
				order: 1,
				attrs: { label: 'address' },
				geo: geo({ column: 40, row: 1, width: 8 }),
			},
			{
				key: 'send',
				name: 'button',
				parent: parentKey,
				order: 1,
				attrs: { label: 'send' },
				geo: geo({ column: 50, row: 1, width: 5 }),
			},
		);
	nodes.push(
		{ key: 'billing', name: 'form', parent: null, order: 1, attrs: { label: 'billing' } },
		// This unrelated input is physically INSIDE the delivery form's bounds.
		{
			key: 'decoy',
			name: 'input',
			parent: 'billing',
			order: 0,
			attrs: { label: 'name' },
			geo: geo({ column: 1, row: 0, width: 5 }),
		},
		{
			key: 'status',
			name: 'text',
			parent: null,
			order: 2,
			attrs: { label: 'status' },
			geo: geo({ column: 0, row: 3, width: 20 }),
		},
	);
	const description: ClackFrame = {
		v: 1,
		frame,
		nodes,
		surface: { columns: 80, rows: 24, row: 1 },
	};
	const paint =
		`\x1b[2J\x1b[1;2HDecoy\x1b[4;1H${text}` +
		(parentKey ? `\x1b[2;${column + 1}H${text}\x1b[2;41HMain St\x1b[2;51HSend` : '');
	return paint + Buffer.from(encodeFrame(description)).toString();
}

const launch = (): TerminalLaunchOptions => ({
	command: process.execPath,
	args: [
		'-e',
		`
		process.stdin.setRawMode(true);
		const output = ${JSON.stringify([
			scene({ frame: 1, text: 'Ryan', column: 10, parentKey: 'delivery' }),
			// One write contains two complete render/description pairs.
			scene({ frame: 2, text: 'Loading', column: 20, parentKey: 'delivery' }) +
				scene({ frame: 3, text: 'Saved', column: 30, parentKey: 'replacement' }),
			scene({ frame: 4, text: 'No form', column: 0, parentKey: null }),
			scene({ frame: 5, text: 'Back', column: 15, parentKey: 'returned' }),
		])};
		let index = 0;
		process.stdin.on('data', bytes => {
			for (const key of bytes.toString()) if (key === '\\r' && index < output.length - 1) process.stdout.write(output[++index]);
		});
		process.stdout.write(output[0]);
	`,
	],
	trace: 'off' as const,
	extensions: [clackTtyExtension()],
});
const delivery = locator('form[label="delivery"]');
const status = locator('text[label="status"]');

test('DOM-scoped children follow parent replacement and retain coherent history', async () => {
	const name = delivery.locator('box[label="fields"]').locator('input[label="name"]');
	await withTerminalAsync(launch(), async (ui) => {
		await ui.expect(name).toContainText('Ryan');
		const movement = await ui.capture(
			{ until: name.satisfies(textContains('Saved')) },
			async (capture) => {
				await capture.keyboard.press('Enter');
			},
		);
		const descriptions = movement.observations.filter(
			(observation) => observation.kind === 'extension',
		);
		expect(descriptions.map((observation) => name.resolve(observation)[0]!.text().trim())).toEqual([
			'Loading',
			'Saved',
		]);
		expect(descriptions.map((observation) => name.resolve(observation)[0]!.bounds.column)).toEqual([
			20, 30,
		]);
		expect(name.resolve(movement.baseline)[0]!.text().trim()).toBe('Ryan');
		expect(name.resolve(movement.baseline)[0]!.bounds.column).toBe(10);

		const removal = await ui.capture(
			{ until: status.satisfies(textContains('No form')) },
			async (capture) => {
				await capture.keyboard.press('Enter');
			},
		);
		expect(name.resolve(removal.observations.at(-1)!)).toEqual([]);
		await ui.keyboard.press('Enter');
		expect((await ui.expect(name).toContainText('Back')).bounds.column).toBe(15);
		expect(name.resolve(movement.baseline)[0]!.text().trim()).toBe('Ryan');
	});
});

test('scope uses ancestry, preserves node-level nth, and never clips to parent geometry', async () => {
	await withTerminalAsync(launch(), async (ui) => {
		await ui.expect(status).toContainText('Ryan');
		await expect(ui.expect(delivery.locator('input')).toContainText('Ryan')).rejects.toMatchObject({
			code: 'GW_LOCATOR_STRICT',
		});
		const movement = await ui.capture(
			{ until: status.satisfies(textContains('Saved')) },
			async (capture) => {
				await capture.keyboard.press('Enter');
			},
		);
		const sample = movement.baseline;
		const texts = (
			query: ReturnType<typeof locator>,
			observation: Observation = sample,
		): string[] => query.resolve(observation).map((region) => region.text().trim());
		expect(texts(delivery.locator('input, button'))).toEqual(['Ryan', 'Main St', 'Send']);
		expect(texts(locator('form').nth(1).locator('input'))).toEqual(['Decoy']);
		expect(texts(delivery.locator('input').nth(1))).toEqual(['Main St']);
		expect(texts(delivery.locator('> box').locator('> input').nth(0))).toEqual(['Ryan']);
		expect(texts(delivery.locator('box, input').locator('input'))).toEqual(['Ryan', 'Main St']);
		expect(texts(delivery.locator('form'))).toEqual([]);
		expect(texts(locator('form').nth(2).locator('input'))).toEqual([]);
		// A geometry-free parent is usable for addressing, but cannot itself be inspected.
		expect(() => delivery.locator('box').resolve(sample)).toThrow(/no geometry/);
		expect(delivery.locator('input').nth(0).resolve(sample)[0]!.bounds).toEqual({
			column: 10,
			row: 1,
			width: 8,
			height: 1,
		});
	});
});

test('invalid child selectors and indices fail at construction', () => {
	for (const source of ['input:focus', 'input::before', 'input:']) {
		expect(() => delivery.locator(source)).toThrowError(
			expect.objectContaining({ code: 'GW_CLACK_SELECTOR_INVALID' }),
		);
	}
	expect(() => delivery.locator('x'.repeat(4097))).toThrowError(
		expect.objectContaining({ code: 'GW_CLACK_SELECTOR_LIMIT' }),
	);
	expect(() => delivery.nth(-1)).toThrowError(
		expect.objectContaining({ code: 'GW_INVALID_OPTIONS' }),
	);
	expect(() => delivery.locator('input').nth(0.5)).toThrowError(
		expect.objectContaining({ code: 'GW_INVALID_OPTIONS' }),
	);
});

test('scoping and nth keep DOM query types; spatial derivation returns a region query', () => {
	const name = delivery.nth(0).locator('input').nth(0);
	expectTypeOf(name).toEqualTypeOf<ClackLocator>();
	const cell = name.derive('first cell', (region) => [{ ...region.bounds, width: 1, height: 1 }]);
	expectTypeOf(cell).toEqualTypeOf<RegionLocator>();
});

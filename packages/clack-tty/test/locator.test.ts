import { expect, test } from 'vitest';
import { locator } from '../src/extension.ts';
import { withTerminal, type Observation } from 'ghostwright';
import type { ClackFrame } from '../src/protocol.ts';

const description: ClackFrame = {
	v: 1,
	frame: 1,
	surface: { columns: 80, rows: 24, row: 1 },
	nodes: [
		{ key: 'form', name: 'form', parent: null, order: 0, attrs: { label: 'delivery' } },
		{
			key: 'name',
			name: 'input',
			parent: 'form',
			order: 0,
			attrs: { label: 'name', role: 'textbox', custom: { ['__proto__']: 'contact' } },
			geo: {
				layout: { x: 0, y: 0, width: 10, height: 1 },
				term: { column: 0, row: 0, width: 10, height: 1 },
			},
		},
		{
			key: 'address',
			name: 'input',
			parent: 'form',
			order: 1,
			attrs: { label: 'address', role: 'textbox' },
			geo: {
				layout: { x: 10, y: 0, width: 10, height: 1 },
				term: { column: 10, row: 0, width: 10, height: 1 },
			},
		},
	],
};

test('queries are immutable, pure, ordered, and work against historical descriptions', async () => {
	const name = locator('form[label="delivery"] > input[label="name"]');
	expect(Object.isFrozen(name)).toBe(true);
	await withTerminal(
		{
			command: process.execPath,
			args: ['-e', 'process.stdout.write("Ryan      Main St")'],
			trace: 'off',
		},
		async (t) => {
			await t.process.waitForExit();
			const observation: Observation = {
				kind: 'extension',
				sequence: 1,
				timestamp: 0,
				extensionId: 'ghostwright.clack-tty',
				protocolFrame: 1,
				description,
				screen: t.screen.current(),
			};
			expect(name.resolve(observation)[0]?.text().trim()).toBe('Ryan');
			expect(locator('input + input').resolve(observation)[0]?.text().trim()).toBe('Main St');
			expect(locator('input').nth(1).resolve(observation)[0]?.bounds.column).toBe(10);
			expect(locator('input[label="absent"]').resolve(observation)).toEqual([]);
			expect(locator('[data-__proto__="contact"]').resolve(observation)[0]?.text().trim()).toBe(
				'Ryan',
			);
			expect(locator('[data-constructor], [data-toString]').resolve(observation)).toEqual([]);
			expect(() => locator('form').resolve(observation)).toThrow(/no geometry/);
			expect(
				name.resolve({ kind: 'screen', sequence: 2, timestamp: 1, screen: t.screen.current() }),
			).toEqual([]);
		},
	);
});
for (const source of [
	'input:focus',
	'[focused]',
	'[focusable]',
	'input:visible',
	'input::before',
	'box:contains(x)',
	'box:',
	'input' + ':has(box)'.repeat(600),
]) {
	test(`rejects unsupported or over-limit selector ${source.slice(0, 40)}`, () =>
		expect(() => locator(source)).toThrow());
}

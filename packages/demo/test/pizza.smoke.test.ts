/**
 * Smoke test proving the Ghostwright <-> pizza demo loop works end to end.
 *
 * This is scaffolding, not real acceptance coverage. It asserts only that the
 * demo boots under a real PTY and paints its initial frame. Replace or extend
 * with actual acceptance tests.
 *
 * Run:  bun test test/pizza.smoke.test.ts
 */
import { test } from 'bun:test';
import { expectTerminal, withTerminalAsync } from 'ghostwright';

const pizza = {
	command: 'bun',
	args: ['src/pizza.ts'],
	cwd: import.meta.dir + '/..',
	viewport: { columns: 80, rows: 24 },
	trace: 'off' as const,
};

test('pizza demo boots under a PTY and renders its form', async () => {
	await withTerminalAsync(pizza, async (terminal) => {
		// Panel title.
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBePresent();

		// The two labelled fields and the two controls built by buildPizza().
		await expectTerminal(terminal.getByText('Name')).toBePresent();
		await expectTerminal(terminal.getByText('Address')).toBePresent();
		await expectTerminal(terminal.getByText('Add card')).toBePresent();
		await expectTerminal(terminal.getByText('Submit')).toBePresent();
	});
});

test('typing into the focused Name field echoes to the terminal', async () => {
	await withTerminalAsync(pizza, async (terminal) => {
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBePresent();

		// useFocus() seeds focus on the first focusable control ("name").
		await terminal.keyboard.type('Ada');
		await expectTerminal(terminal.getByText('Ada')).toBeStable();
	});
});

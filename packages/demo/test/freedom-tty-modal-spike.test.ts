import { expect, test } from 'bun:test';
import { expectTerminal, withTerminalAsync, type AsyncTerminal } from 'ghostwright';
import { FreedomTtyExtension } from './support/freedom-tty-extension.ts';

const pizza = {
	command: 'bun',
	args: ['src/pizza.ts'],
	cwd: import.meta.dir + '/..',
	env: { GHOSTWRIGHT_FREEDOM_TTY: '1' },
	viewport: { columns: 80, rows: 24 },
	trace: 'off' as const,
};

/** Bind semantic-count assertions to one terminal session. */
function semanticCountExpectation(terminal: AsyncTerminal) {
	return async (
		selector: ReturnType<FreedomTtyExtension['locator']>,
		count: number,
	): Promise<void> => {
		await expectTerminal(terminal).toSatisfy(() => selector.matches().length === count, {
			settleMs: 100,
		});
	};
}

test('Freedom semantics expose modal focus capture through CSS-like selectors', async () => {
	await withTerminalAsync(pizza, async (terminal) => {
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBeStable();

		const freedom = new FreedomTtyExtension(terminal),
			expectCount = semanticCountExpectation(terminal),
			modal = freedom.locator('card-modal:focus-root'),
			focused = freedom.locator(':focus');

		// The locator is created before the modal exists. It is lazy and resolves
		// against each newest semantic frame rather than retaining stale geometry.
		expect(modal.matches()).toHaveLength(0);
		await expectCount(freedom.locator(':root:focus-root'), 1);
		await expectCount(freedom.locator('form > name:focus'), 1);
		expect(focused.matches().map((node) => node.name)).toEqual(['name']);

		// Name -> Address -> Add card, then activate the control.
		await terminal.keyboard.press('Tab');
		await terminal.keyboard.press('Tab');
		await expectCount(freedom.locator('form > card:focus'), 1);
		await terminal.keyboard.press('Enter');

		await expectCount(modal, 1);
		await expectCount(freedom.locator('card-modal:focus-root > card-number:focus'), 1);
		expect(freedom.locator('card-modal:focus-root > *').matches()).toHaveLength(5);
		expect(freedom.locator('card-modal > [role=textbox]').matches()).toHaveLength(3);
		expect(freedom.locator('[role=dialog]:focus-root').matches()).toHaveLength(1);
		expect(freedom.locator('card-modal:has(> card-number:focus)').matches()).toHaveLength(1);
		expect(freedom.locator('card-modal > :nth-child(1):focus').matches()).toHaveLength(1);
		expect(freedom.locator('card-number + expiry').matches()).toHaveLength(1);
		expect(freedom.locator('card-number ~ confirm').matches()).toHaveLength(1);
		expect(freedom.locator('card-number, expiry').matches()).toHaveLength(2);
		expect(freedom.locator('card-modal [role^=text]:not(cvc)').matches()).toHaveLength(2);
		expect(freedom.locator(`#${modal.unique().key}`).matches()).toHaveLength(1);
		expect(freedom.current()?.focusStack).toEqual([modal.unique().key]);
		expect(freedom.locator('form :focus').matches()).toHaveLength(0);
		expect(() => freedom.locator('card-modal::before')).toThrow(
			'Pseudo-elements are not supported',
		);
		expect(() => freedom.locator('card-modal:contains(Card)')).toThrow(
			'Pseudo-class :contains is not supported',
		);
		expect(() => freedom.locator('card-modal < :focus')).toThrow(
			'Selector traversal parent is not supported',
		);
		expect(() => freedom.locator('x'.repeat(4097))).toThrow('Selector exceeds 4096 bytes');
		expect(() => freedom.locator('root:has(root:has(root:has(root)))')).toThrow(
			'Nested :has() exceeds depth 2',
		);
		expect(focused.matches().map((node) => node.name)).toEqual(['card-number']);

		// Freedom contributes identity/focus state; tty contributes geometry.
		// Those two views point at the same visible modal and native caret.
		await expectTerminal(modal.getByText('Card details')).toBePresent();
		expect(freedom.locator('card-modal > card-number').containsCursor()).toBe(true);
		expect(modal.bounds()).toBeDefined();
		expect(freedom.locator('card-modal > card-number').bounds()).toBeDefined();

		// Input values are intentionally not part of the semantic payload. This
		// must remain true even after sensitive-looking data enters the model.
		await terminal.keyboard.type('4111111111111111');
		await expectTerminal(terminal.getByText('4111111111111111')).toBeStable();
		expect(JSON.stringify(freedom.current())).not.toContain('4111111111111111');
		expect(JSON.stringify(freedom.current())).not.toContain('"value"');
		expect(JSON.stringify(freedom.current())).not.toContain('"caret"');

		// Tab is trapped in the active modal focus root and wraps after Confirm.
		for (const name of ['expiry', 'cvc', 'cancel', 'confirm', 'card-number']) {
			await terminal.keyboard.press('Tab');
			await expectCount(freedom.locator(`card-modal:focus-root > ${name}:focus`), 1);
			expect(freedom.locator('form :focus').matches()).toHaveLength(0);
			expect(focused.matches().map((node) => node.name)).toEqual([name]);
		}

		// Move to Cancel and close. The pre-existing lazy locator becomes absent,
		// and Freedom restores focus to the control that opened the modal.
		for (const name of ['expiry', 'cvc', 'cancel']) {
			await terminal.keyboard.press('Tab');
			await expectCount(freedom.locator(`card-modal > ${name}:focus`), 1);
		}
		await terminal.keyboard.press('Enter');

		await expectCount(modal, 0);
		await expectCount(freedom.locator('form > card:focus'), 1);
		expect(focused.matches().map((node) => node.name)).toEqual(['card']);
		expect(freedom.current()?.focusStack).toEqual([]);

		// Every live semantic node in the final frame has corresponding Clay
		// geometry. The removed modal nodes are absent rather than stale.
		expect(freedom.current()?.nodes.every((node) => node.rect !== undefined)).toBe(true);
		expect(freedom.locator('card-modal *').matches()).toHaveLength(0);
		const frameNumbers = freedom.frames().map((frame) => frame.frame);
		expect(
			frameNumbers.every((frame, index) => index === 0 || frame > frameNumbers[index - 1]),
		).toBe(true);
	});
});

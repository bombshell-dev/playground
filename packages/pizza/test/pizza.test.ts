import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-unassigned-import -- Install typed terminal and clack matchers in Vitest.
import '@ghostwright/clack-tty/vitest';
import { withTerminal, settled, type TerminalLaunchOptions } from 'ghostwright';
import { clackTtyExtension, locator } from '@ghostwright/clack-tty';

// Launch the real CLI. Recipes address controls; runner assertions inspect
// frozen terminal evidence. Only waitFor retries an assertion.
const pizza = (): TerminalLaunchOptions => ({
	command: process.execPath,
	args: ['--import', 'tsx', 'src/pizza.ts'],
	cwd: new URL('..', import.meta.url).pathname,
	viewport: { columns: 80, rows: 24 },
	env: { CLACK_UI_SEMANTIC: '1' },
	extensions: [clackTtyExtension()],
	selector: locator,
});

const delivery = locator('form[label="delivery"]');
const name = delivery.locator('input[label="name"]');
const address = delivery.locator('input[label="address"]');
const addCard = delivery.locator('button[label="add-card"]');
const cardDetails = locator('dialog[label="card"]');
const cardNumber = cardDetails.locator('input[label="card-number"]');
const expiry = cardDetails.locator('input[label="expiry"]');
const cvc = cardDetails.locator('input[label="cvc"]');
const submitCard = cardDetails.locator('button[label="submit-card"]');

test('tell the pizza shop where to deliver', async () => {
	await withTerminal(pizza(), async ({ screen, keyboard, waitFor }) => {
		expect(await screen.findBySelector('form[label="delivery"]')).toContainText('Pizza Delivery');

		// The name field is ready to type into as soon as the form opens.
		await waitFor(() => expect(screen.getBy(name)).toHaveInputFocus());
		await keyboard.type('Ryan');
		await waitFor(() => expect(screen.getBy(name)).toContainText('Ryan'));

		// Continue with the keyboard. Input is outside the retried assertions.
		await keyboard.press('Tab');
		await waitFor(() => expect(screen.getBy(address)).toHaveInputFocus());
		await keyboard.type('1 Main St');
		await waitFor(() => {
			expect(screen.getBy(address)).toContainText('1 Main St');
			expect(screen.getBy(name)).toContainText('Ryan');
		});
	});
});

test('keep keyboard navigation inside card details until the form is submitted', async () => {
	await withTerminal(pizza(), async ({ screen, keyboard, waitFor }) => {
		// Reach "Add card" from the delivery form.
		await waitFor(() => expect(screen.getBy(name)).toHaveInputFocus());
		await keyboard.press('Tab');
		await waitFor(() => expect(screen.getBy(address)).toHaveInputFocus());
		await keyboard.press('Tab');
		await waitFor(() => expect(screen.getBy(addCard)).toHaveButtonFocus('Add card'));
		await keyboard.press('Enter');
		expect(await screen.findBy(cardDetails)).toContainText('Card Details');

		// Tab visits each card field in order.
		await waitFor(() => expect(screen.getBy(cardNumber)).toHaveInputFocus());
		await keyboard.press('Tab');
		await waitFor(() => expect(screen.getBy(expiry)).toHaveInputFocus());
		await keyboard.press('Tab');
		await waitFor(() => expect(screen.getBy(cvc)).toHaveInputFocus());
		await keyboard.press('Tab');
		await waitFor(() => expect(screen.getBy(submitCard)).toHaveButtonFocus('Submit card'));

		// Neither direction lets focus escape into the form behind the dialog.
		await keyboard.press('Tab');
		await waitFor(() => expect(screen.getBy(cardNumber)).toHaveInputFocus());
		await keyboard.press('Shift+Tab');
		await waitFor(() => expect(screen.getBy(submitCard)).toHaveButtonFocus('Submit card'));

		// Closing the dialog returns us to the button that opened it.
		await keyboard.press('Enter');
		await waitFor(() => {
			expect(screen.getBy(addCard)).toHaveButtonFocus('Add card');
			expect(screen.queryBy(cardDetails)).toBeNull();
		});
		await keyboard.press('Tab');
		await waitFor(() => expect(screen.getBy(name)).toHaveInputFocus());
	});
});

test('keep the delivery form usable in a narrow terminal', async () => {
	await withTerminal(pizza(), async ({ screen, keyboard, waitFor, capture }) => {
		await waitFor(() => expect(screen.getBy(name)).toHaveInputFocus());

		// Record the resize until this form settles, rather than sleeping and hoping.
		const recording = await capture({ until: settled(delivery, 50) }, async ({ resize }) => {
			await resize({ columns: 36, rows: 20 });
		});

		// These assertions inspect historical evidence, not the live screen.
		const resizedForm = recording.observations
			.flatMap((observation) => delivery.resolve(observation))
			.at(-1)!;
		expect(resizedForm.screen.viewport.columns).toBe(36);
		expect(resizedForm.visibleBounds).toEqual(resizedForm.bounds);
		expect(resizedForm).toContainText('Pizza Delivery');

		await keyboard.press('Enter');
		expect(await screen.findBy(cardDetails)).toContainText('Card Details');
		await waitFor(() => expect(screen.getBy(cardNumber)).toHaveInputFocus());
	});
});

test('edit the name with the cursor, then continue to the next control', async () => {
	await withTerminal(pizza(), async ({ screen, keyboard, waitFor }) => {
		await waitFor(() => expect(screen.getBy(name)).toHaveInputFocus());
		await keyboard.type('Ryn');
		await waitFor(() => expect(screen.getBy(name)).toContainText('Ryn'));

		// Correct the typo in place, just as a person would.
		await keyboard.press('ArrowLeft');
		await keyboard.type('a');
		await waitFor(() => {
			const corrected = screen.getBy(name);
			expect(corrected).toContainText('Ryan');
			expect(corrected).toContainCursor({ visible: true });
		});

		await keyboard.press('Tab');
		await waitFor(() => expect(screen.getBy(address)).toHaveInputFocus());
		await keyboard.press('Tab');
		await waitFor(() => {
			const button = screen.getBy(addCard);
			expect(button).toHaveButtonFocus('Add card');
			// Buttons show focus, but not a text-entry cursor.
			expect(button.screen.cursor.visible).toBe(false);
		});
	});
});

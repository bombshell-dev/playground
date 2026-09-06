import { test } from 'vitest';
import { withTerminalAsync, type TerminalLaunchOptions } from 'ghostwright';
import { clackTtyExtension, expectUI, locator } from '@ghostwright/clack-tty';

// Launch the Preact app in a real terminal. Locators find the controls;
// assertions check the text, borders, and cursor drawn on that terminal.
const pizza = (): TerminalLaunchOptions => ({
	command: process.execPath,
	args: ['--import', 'tsx', 'src/index.tsx'],
	cwd: new URL('..', import.meta.url).pathname,
	viewport: { columns: 80, rows: 24 },
	env: { CLACK_UI_SEMANTIC: '1' },
	extensions: [clackTtyExtension()],
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

test('return from card details without losing the delivery address', async () => {
	await withTerminalAsync(pizza(), async (ui) => {
		// Tell the shop who we are and where to deliver.
		await ui.expect(delivery).toContainText('Pizza Delivery');
		await expectUI(ui, name).toHaveInputFocus();
		await ui.keyboard.type('Ryan');
		await ui.expect(name).toContainText('Ryan');

		await ui.keyboard.press('Tab');
		await expectUI(ui, address).toHaveInputFocus();
		await ui.keyboard.type('1 Main St');
		await ui.expect(address).toContainText('1 Main St');

		// Open the card form with the keyboard. Focus moves into the dialog.
		await ui.keyboard.press('Tab');
		await expectUI(ui, addCard).toHaveButtonFocus('Add card');
		await ui.keyboard.press('Enter');
		await ui.expect(cardDetails).toContainText('Card Details');

		await expectUI(ui, cardNumber).toHaveInputFocus();
		await ui.keyboard.type('4242');
		await ui.expect(cardNumber).toContainText('4242');

		await ui.keyboard.press('Tab');
		await expectUI(ui, expiry).toHaveInputFocus();
		await ui.keyboard.type('12/30');
		await ui.expect(expiry).toContainText('12/30');

		await ui.keyboard.press('Tab');
		await expectUI(ui, cvc).toHaveInputFocus();
		await ui.keyboard.type('123');
		await ui.expect(cvc).toContainText('123');

		// Submit the form. We return to the opener, with our delivery details intact.
		await ui.keyboard.press('Tab');
		await expectUI(ui, submitCard).toHaveButtonFocus('Submit card');
		await ui.keyboard.press('Enter');
		await expectUI(ui, addCard).toHaveButtonFocus('Add card');
		await ui.expect(name).toContainText('Ryan');
		await ui.expect(address).toContainText('1 Main St');

		await ui.keyboard.press('Tab');
		await expectUI(ui, name).toHaveInputFocus();
	});
});

test('correct a typo before moving to the address', async () => {
	await withTerminalAsync(pizza(), async (ui) => {
		await expectUI(ui, name).toHaveInputFocus();
		await ui.keyboard.type('Ryn');
		await ui.expect(name).toContainText('Ryn');

		// Move before the final letter and insert the missing "a".
		await ui.keyboard.press('ArrowLeft');
		await ui.keyboard.type('a');
		await ui.expect(name).toContainText('Ryan');
		await ui.expect(name).toContainCursor({ visible: true });

		// Tab changes focus, not the name we just corrected.
		await ui.keyboard.press('Tab');
		await expectUI(ui, address).toHaveInputFocus();
		await ui.expect(name).toContainText('Ryan');
	});
});

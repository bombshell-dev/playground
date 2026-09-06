import { expect, test } from 'vitest';
import { withTerminalAsync, settled } from 'ghostwright';
import { clackTtyExtension, expectUI, locator } from '@ghostwright/clack-tty';

// No application internals: launch the CLI, use its keyboard, and check what
// appears in the terminal. Locators give those visible controls useful names.
const pizza = () => ({
	command: process.execPath,
	args: ['--import', 'tsx', 'src/pizza.ts'],
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

test('tell the pizza shop where to deliver', async () => {
	await withTerminalAsync(pizza(), async (ui) => {
		await ui.expect(delivery).toContainText('Pizza Delivery');

		// The name field is ready to type into as soon as the form opens.
		await expectUI(ui, name).toHaveInputFocus();
		await ui.keyboard.type('Ryan');
		await ui.expect(name).toContainText('Ryan');

		// Continue with the keyboard. Assertions wait for the visible result.
		await ui.keyboard.press('Tab');
		await expectUI(ui, address).toHaveInputFocus();
		await ui.keyboard.type('1 Main St');
		await ui.expect(address).toContainText('1 Main St');
		await ui.expect(name).toContainText('Ryan');
	});
});

test('keep keyboard navigation inside card details until the form is submitted', async () => {
	await withTerminalAsync(pizza(), async (ui) => {
		// Reach "Add card" from the delivery form.
		await expectUI(ui, name).toHaveInputFocus();
		await ui.keyboard.press('Tab');
		await expectUI(ui, address).toHaveInputFocus();
		await ui.keyboard.press('Tab');
		await expectUI(ui, addCard).toHaveButtonFocus('Add card');
		await ui.keyboard.press('Enter');
		await ui.expect(cardDetails).toContainText('Card Details');

		// Tab visits each card field in order.
		await expectUI(ui, cardNumber).toHaveInputFocus();
		await ui.keyboard.press('Tab');
		await expectUI(ui, expiry).toHaveInputFocus();
		await ui.keyboard.press('Tab');
		await expectUI(ui, cvc).toHaveInputFocus();
		await ui.keyboard.press('Tab');
		await expectUI(ui, submitCard).toHaveButtonFocus('Submit card');

		// Neither direction lets focus escape into the form behind the dialog.
		await ui.keyboard.press('Tab');
		await expectUI(ui, cardNumber).toHaveInputFocus();
		await ui.keyboard.press('Shift+Tab');
		await expectUI(ui, submitCard).toHaveButtonFocus('Submit card');

		// Closing the dialog returns us to the button that opened it.
		await ui.keyboard.press('Enter');
		await expectUI(ui, addCard).toHaveButtonFocus('Add card');
		await ui.keyboard.press('Tab');
		await expectUI(ui, name).toHaveInputFocus();
	});
});

test('keep the delivery form usable in a narrow terminal', async () => {
	await withTerminalAsync(pizza(), async (ui) => {
		await expectUI(ui, name).toHaveInputFocus();

		// Record the resize until this form settles, rather than sleeping and hoping.
		const recording = await ui.capture({ until: settled(delivery, 50) }, async (capture) => {
			await capture.resize({ columns: 36, rows: 20 });
		});

		// Inspect the form as it was drawn in the recording, not the live screen.
		const renderedForms = recording.observations.flatMap((observation) =>
			delivery.resolve(observation),
		);
		const resizedForm = renderedForms.at(-1)!;
		expect(resizedForm.screen.viewport.columns).toBe(36);
		expect(resizedForm.visibleBounds).toEqual(resizedForm.bounds);
		expect(resizedForm.text()).toContain('Pizza Delivery');

		// The smaller window still lets us continue to card details.
		await ui.keyboard.press('Enter');
		await ui.expect(cardDetails).toContainText('Card Details');
		await expectUI(ui, cardNumber).toHaveInputFocus();
	});
});

test('edit the name with the cursor, then continue to the next control', async () => {
	await withTerminalAsync(pizza(), async (ui) => {
		await expectUI(ui, name).toHaveInputFocus();
		await ui.keyboard.type('Ryn');
		await ui.expect(name).toContainText('Ryn');

		// Correct the typo in place, just as a person would.
		await ui.keyboard.press('ArrowLeft');
		await ui.keyboard.type('a');
		await ui.expect(name).toContainText('Ryan');
		await ui.expect(name).toContainCursor({ visible: true });

		await ui.keyboard.press('Tab');
		await expectUI(ui, address).toHaveInputFocus();
		await ui.keyboard.press('Tab');
		const focusedButton = await expectUI(ui, addCard).toHaveButtonFocus('Add card');

		// Buttons show focus, but not a text-entry cursor.
		expect(focusedButton.screen.cursor.visible).toBe(false);
	});
});

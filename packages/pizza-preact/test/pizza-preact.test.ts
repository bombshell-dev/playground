import { expect } from 'vitest';
import { test } from 'ghostwright/vitest';
// oxlint-disable-next-line import/no-unassigned-import -- Install typed terminal and clack matchers in Vitest.
import '@ghostwright/clack-tty/vitest';
import { type TerminalLaunchOptions } from 'ghostwright';
import { clackTtyExtension, locator } from '@ghostwright/clack-tty';

// The runner fixture owns each terminal and retains artifacts on test failure.
// The app is a real child process; assertions read terminal cells, not Preact state.
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

test('return from card details without losing the delivery address', async ({ launchTerminal }) => {
	const { screen, keyboard, waitFor } = await launchTerminal(pizza());

	// Tell the shop who we are and where to deliver.
	expect(await screen.findBy(delivery)).toContainText('Pizza Delivery');
	await waitFor(() => expect(screen.getBy(name)).toHaveInputFocus());
	await keyboard.type('Ryan');
	await waitFor(() => expect(screen.getBy(name)).toContainText('Ryan'));

	await keyboard.press('Tab');
	await waitFor(() => expect(screen.getBy(address)).toHaveInputFocus());
	await keyboard.type('1 Main St');
	await waitFor(() => expect(screen.getBy(address)).toContainText('1 Main St'));

	// Open the card form with the keyboard. Focus moves into the dialog.
	await keyboard.press('Tab');
	await waitFor(() => expect(screen.getBy(addCard)).toHaveButtonFocus('Add card'));
	await keyboard.press('Enter');
	expect(await screen.findBy(cardDetails)).toContainText('Card Details');

	await waitFor(() => expect(screen.getBy(cardNumber)).toHaveInputFocus());
	await keyboard.type('4242');
	await waitFor(() => expect(screen.getBy(cardNumber)).toContainText('4242'));

	await keyboard.press('Tab');
	await waitFor(() => expect(screen.getBy(expiry)).toHaveInputFocus());
	await keyboard.type('12/30');
	await waitFor(() => expect(screen.getBy(expiry)).toContainText('12/30'));

	await keyboard.press('Tab');
	await waitFor(() => expect(screen.getBy(cvc)).toHaveInputFocus());
	await keyboard.type('123');
	await waitFor(() => expect(screen.getBy(cvc)).toContainText('123'));

	// Return to the opener, with our delivery details intact.
	await keyboard.press('Tab');
	await waitFor(() => expect(screen.getBy(submitCard)).toHaveButtonFocus('Submit card'));
	await keyboard.press('Enter');
	await waitFor(() => {
		expect(screen.getBy(addCard)).toHaveButtonFocus('Add card');
		expect(screen.queryBy(cardDetails)).toBeNull();
		expect(screen.getBy(name)).toContainText('Ryan');
		expect(screen.getBy(address)).toContainText('1 Main St');
	});

	await keyboard.press('Tab');
	await waitFor(() => expect(screen.getBy(name)).toHaveInputFocus());
});

test('correct a typo before moving to the address', async ({ launchTerminal }) => {
	const { screen, keyboard, waitFor } = await launchTerminal(pizza());
	await waitFor(() => expect(screen.getBy(name)).toHaveInputFocus());
	await keyboard.type('Ryn');
	await waitFor(() => expect(screen.getBy(name)).toContainText('Ryn'));

	// Move before the final letter and insert the missing "a".
	await keyboard.press('ArrowLeft');
	await keyboard.type('a');
	await waitFor(() => {
		const corrected = screen.getBy(name);
		expect(corrected).toContainText('Ryan');
		expect(corrected).toContainCursor({ visible: true });
	});

	// Tab changes focus, not the name we just corrected.
	await keyboard.press('Tab');
	await waitFor(() => {
		expect(screen.getBy(address)).toHaveInputFocus();
		expect(screen.getBy(name)).toContainText('Ryan');
	});
});

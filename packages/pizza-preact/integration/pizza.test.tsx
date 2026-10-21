import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-unassigned-import -- Install terminal-evidence and Clack focus matchers.
import '@ghostwright/clack-tty/vitest';
import { createUI } from '@clack/ui';
import { createRoot } from '@clack/ui-preact';
import { clackTtyExtension, locator } from '@ghostwright/clack-tty';
import { useSemantic } from '@ghostwright/clack-tty/producer';
import { createTerminal } from '../../../experiments/ghostwright/spikes/in-process.ts';
import { recordTest } from '../../../experiments/ghostwright/spikes/recording-vitest.ts';
import { PizzaDelivery } from '../src/app.tsx';

test('fills the Preact pizza form and returns from its modal through injected terminal streams', async (context) => {
	const recording = recordTest(context);
	await using terminal = await createTerminal({ extensions: [clackTtyExtension(), recording] });
	await using ui = await createUI({ ...terminal.appIO, extensions: [useSemantic] });
	using root = createRoot(ui.document.documentElement);
	using _capture = recording;
	root.render(<PizzaDelivery />);
	terminal.run(ui.main);
	const { screen, keyboard, waitFor } = terminal;
	const delivery = locator('form[label="delivery"]');
	const name = delivery.locator('input[label="name"]');
	const address = delivery.locator('input[label="address"]');
	const opener = delivery.locator('button[label="add-card"]');
	const dialog = locator('dialog[label="card"]');
	const number = dialog.locator('input[label="card-number"]');
	const submit = dialog.locator('button[label="submit-card"]');

	await waitFor(() => expect(screen.getBy(name)).toHaveInputFocus());
	await keyboard.type('Ryan');
	await keyboard.press('Tab');
	await waitFor(() => expect(screen.getBy(address)).toHaveInputFocus());
	await keyboard.type('1 Main St');
	await keyboard.press('Tab');
	await waitFor(() => expect(screen.getBy(opener)).toHaveButtonFocus('Add card'));
	await keyboard.press('Enter');
	expect(await screen.findBy(dialog)).toContainText('Card Details');
	await waitFor(() => expect(screen.getBy(number)).toHaveInputFocus());
	await keyboard.type('4242');
	await waitFor(() => expect(screen.getBy(number)).toContainText('4242'));
	await keyboard.press('Shift+Tab');
	await waitFor(() => expect(screen.getBy(submit)).toHaveButtonFocus('Submit card'));
	await keyboard.press('Tab');
	await waitFor(() => expect(screen.getBy(number)).toHaveInputFocus());
	await keyboard.press('Shift+Tab');
	await keyboard.press('Enter');
	await waitFor(() => {
		expect(screen.queryBy(dialog)).toBeNull();
		expect(screen.getBy(opener)).toHaveButtonFocus('Add card');
		expect(screen.getBy(name)).toContainText('Ryan');
		expect(screen.getBy(address)).toContainText('1 Main St');
	});
});

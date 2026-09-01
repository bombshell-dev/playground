import { expect, test } from 'vitest';
import { expectTerminal, withTerminalAsync } from 'ghostwright';
import {
	clackTtyExtension,
	expectFocused,
	expectTreeCondition,
	type ClackTtySession,
} from '@ghostwright/clack-tty';

// Outside-in acceptance suite: the pizza application is a black box. The tests
// drive it through the real terminal (ghostwright PTY) and observe only the
// visible screen and the semantic tree it emits. No implementation knowledge.
const extension = clackTtyExtension();

const entry = () => ({
	command: process.execPath,
	args: ['--import', 'tsx', 'src/pizza.ts'],
	cwd: new URL('..', import.meta.url).pathname,
	viewport: { columns: 80, rows: 24 },
	env: { CLACK_UI_SEMANTIC: '1' },
	trace: 'off' as const,
	extensions: [extension],
});

type Terminal = Parameters<Parameters<typeof withTerminalAsync>[1]>[0];

function semantic(terminal: Terminal) {
	return terminal.extension(extension) as ClackTtySession;
}

async function tabTo(terminal: Terminal, session: ClackTtySession, expectedLabel: string) {
	const previousLabel = session.locator('[focused]').matches()[0]?.attrs.label;
	for (let attempt = 0; attempt < 3; attempt++) {
		await terminal.keyboard.press('Tab');
		try {
			await expectTreeCondition(
				terminal,
				() => session.locator('[focused]').matches()[0]?.attrs.label !== previousLabel,
				`focus leaves ${previousLabel}`,
				1200,
			);
		} catch {
			if (attempt < 2) continue;
			throw new Error(`focus did not leave ${previousLabel}`);
		}

		const actualLabel = session.locator('[focused]').matches()[0]?.attrs.label;
		expect(actualLabel).toBe(expectedLabel);
		return;
	}
}

test('renders the delivery form and focuses the first field', async () => {
	await withTerminalAsync(entry(), async (terminal) => {
		// visible screen
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBeStable();

		// semantic tree: a delivery form with name and address fields
		const form = semantic(terminal).locator('form[label="delivery"]');
		await expectTreeCondition(terminal, () => form.matches().length === 1, 'form in tree');
		expect(semantic(terminal).locator('input[label="name"]').matches()).toHaveLength(1);
		expect(semantic(terminal).locator('input[label="address"]').matches()).toHaveLength(1);

		// focus starts on the first field
		await expectFocused(terminal, semantic(terminal).locator('input[label="name"]'));
	});
});

test('reflows forms when the terminal resizes', async () => {
	await withTerminalAsync(entry(), async (terminal) => {
		const session = semantic(terminal);
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBeStable();

		await terminal.resize({ columns: 36, rows: 20 });

		const fitsSurface = (selector: string) => {
			const frame = session.current();
			const geometry = session.locator(selector).matches()[0]?.geo;
			const term = geometry?.term;
			const visible = geometry?.visible;
			return (
				frame?.surface.columns === 36 &&
				frame.surface.rows === 20 &&
				term !== undefined &&
				visible !== undefined &&
				term.column >= 0 &&
				term.row >= 0 &&
				term.column + term.width <= frame.surface.columns &&
				term.row + term.height <= frame.surface.rows &&
				visible.column === term.column &&
				visible.row === term.row &&
				visible.width === term.width &&
				visible.height === term.height
			);
		};

		await expectTreeCondition(
			terminal,
			() => fitsSurface('form[label="delivery"]'),
			'delivery form fits resized surface',
		);

		await terminal.keyboard.press('Enter');
		await expectTreeCondition(
			terminal,
			() => fitsSurface('dialog[role="dialog"][label="card"]'),
			'card dialog fits resized surface',
		);
	});
});

test('Tab cycles the delivery fields and wraps', async () => {
	await withTerminalAsync(entry(), async (terminal) => {
		const session = semantic(terminal);
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBeStable();
		const name = session.locator('input[label="name"]');
		const address = session.locator('input[label="address"]');

		const addCard = session.locator('button[label="add-card"]');
		await expectFocused(terminal, name);
		await terminal.keyboard.press('Tab');
		await expectFocused(terminal, address);
		await terminal.keyboard.press('Tab');
		await expectFocused(terminal, addCard);
		// the dialog is closed, so the cycle wraps back to the first field
		await terminal.keyboard.press('Tab');
		await expectFocused(terminal, name);
	});
});

test('typing updates the field value on screen and in the tree', async () => {
	await withTerminalAsync(entry(), async (terminal) => {
		const session = semantic(terminal);
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBeStable();
		const name = session.locator('input[label="name"]');
		const address = session.locator('input[label="address"]');

		await terminal.keyboard.type('Ryan');
		await expectTerminal(name.getByText('Ryan')).toBePresent();

		await terminal.keyboard.press('Tab');
		await terminal.keyboard.type('1 Main St');
		await expectTerminal(address.getByText('1 Main St')).toBePresent();

		// the greeting-style header is untouched
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBeStable();
	});
});

test('Enter opens the card dialog and focuses the card number', async () => {
	await withTerminalAsync(entry(), async (terminal) => {
		const session = semantic(terminal);
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBeStable();

		await terminal.keyboard.press('Enter');

		const dialog = session.locator('dialog[role="dialog"][label="card"]');
		await expectTreeCondition(terminal, () => dialog.matches().length === 1, 'dialog opens');
		expect(session.locator('input[label="card-number"]').matches()).toHaveLength(1);
		expect(session.locator('input[label="expiry"]').matches()).toHaveLength(1);
		expect(session.locator('input[label="cvc"]').matches()).toHaveLength(1);
		await expectFocused(terminal, session.locator('input[label="card-number"]'));

		// the delivery form stays mounted with its values
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBeStable();
	});
});

test('the card journey: type through the dialog fields', async () => {
	await withTerminalAsync(entry(), async (terminal) => {
		const session = semantic(terminal);
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBeStable();
		await terminal.keyboard.press('Enter');
		const dialog = session.locator('dialog[role="dialog"][label="card"]');
		await expectTreeCondition(terminal, () => dialog.matches().length === 1, 'dialog opens');

		const cardNumber = session.locator('input[label="card-number"]');
		const expiry = session.locator('input[label="expiry"]');
		const cvc = session.locator('input[label="cvc"]');

		await terminal.keyboard.type('4111111');
		await expectTerminal(cardNumber.getByText('4111111')).toBePresent();

		await terminal.keyboard.press('Tab');
		await expectFocused(terminal, expiry);
		await terminal.keyboard.type('12/26');
		await expectTerminal(expiry.getByText('12/26')).toBePresent();

		await terminal.keyboard.press('Tab');
		await expectFocused(terminal, cvc);
		await terminal.keyboard.type('123');
		await expectTerminal(cvc.getByText('123')).toBePresent();
	});
});

test('Enter closes the dialog, keeps form values, and restores focus', async () => {
	await withTerminalAsync(entry(), async (terminal) => {
		const session = semantic(terminal);
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBeStable();
		const name = session.locator('input[label="name"]');
		const dialog = session.locator('dialog[role="dialog"][label="card"]');

		// build state: name typed, dialog opened
		await terminal.keyboard.type('Ryan');
		await expectTerminal(name.getByText('Ryan')).toBePresent();
		await terminal.keyboard.press('Enter');
		await expectTreeCondition(terminal, () => dialog.matches().length === 1, 'dialog opens');

		// close: Enter on a focused card field
		await terminal.keyboard.press('Enter');
		await expectTreeCondition(terminal, () => dialog.matches().length === 0, 'dialog closes');
		expect(session.locator('input[label="card-number"]').matches()).toHaveLength(0);

		// form values survive the dialog round trip
		await expectTerminal(name.getByText('Ryan')).toBePresent();

		// focus returns to the control that opened the modal
		await expectFocused(terminal, name);
	});
});

test('with the dialog open, Tab is contained by the modal', async () => {
	await withTerminalAsync(entry(), async (terminal) => {
		const session = semantic(terminal);
		await expectTerminal(terminal.getByText('Pizza Delivery')).toBeStable();
		const dialog = session.locator('dialog[role="dialog"][label="card"]');
		const order = ['expiry', 'cvc', 'submit-card', 'card-number'];

		await terminal.keyboard.press('Enter');
		await expectTreeCondition(terminal, () => dialog.matches().length === 1, 'dialog opens');

		// the app focuses card-number when the dialog opens; walk the full cycle
		const labels: (string | undefined)[] = [];
		await expectFocused(terminal, session.locator('input[label="card-number"]'));
		for (const label of order) {
			await tabTo(terminal, session, label);
			labels.push(session.locator('[focused]').matches()[0]?.attrs.label);
		}
		expect(labels).toEqual(order);

		await terminal.keyboard.press('Shift+Tab');
		await expectFocused(terminal, session.locator('button[label="submit-card"]'));
	});
});

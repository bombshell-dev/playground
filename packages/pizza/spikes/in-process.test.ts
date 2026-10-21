import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-unassigned-import -- Install the existing terminal and Clack matchers.
import '@ghostwright/clack-tty/vitest';
import { createUI } from '@clack/ui';
import { clackTtyExtension, locator } from '@ghostwright/clack-tty';
import { useSemantic } from '@ghostwright/clack-tty/producer';
import type { UIExtension } from '@clack/ui/extensions';
import { createTerminal } from '../../../experiments/ghostwright/spikes/in-process.ts';
import { mountPizza } from '../src/app.ts';

class TestBodyError extends Error {}

// Install explicitly for this UI, without changing process.env or a global registry.
const describeUI: UIExtension = (context) => {
	return useSemantic(context);
};
const delivery = locator('form[label="delivery"]');
const name = delivery.locator('input[label="name"]');
const address = delivery.locator('input[label="address"]');
const addCard = delivery.locator('button[label="add-card"]');
const dialog = locator('dialog[label="card"]');
const number = dialog.locator('input[label="card-number"]');
const submit = dialog.locator('button[label="submit-card"]');

test('renders an appended text node through injected streams', async () => {
	await using terminal = await createTerminal();
	await using ui = await createUI(terminal.appIO);

	terminal.run(ui.main);
	ui.document.documentElement.appendChild(ui.document.createTextNode('hello world!'));

	expect(await terminal.screen.findByText('hello world!')).toBeVisible();
});

test('orders a pizza through the same UI and keyboard, without a command or fixture file', async () => {
	await using terminal = await createTerminal({ extensions: [clackTtyExtension()] });
	await using ui = await createUI({ ...terminal.appIO, extensions: [describeUI] });
	await mountPizza(ui.document);
	terminal.run(ui.main);
	const { screen, keyboard, waitFor } = terminal;

	expect(await screen.findBy(delivery)).toContainText('Pizza Delivery');
	await waitFor(() => expect(screen.getBy(name)).toHaveInputFocus());
	await keyboard.type('Ryn');
	await keyboard.press('ArrowLeft');
	await keyboard.type('a');
	await waitFor(() => {
		expect(screen.getBy(name)).toContainText('Ryan');
		expect(screen.getBy(name)).toContainCursor({ visible: true });
	});

	await keyboard.press('Tab');
	await waitFor(() => expect(screen.getBy(address)).toHaveInputFocus());
	await keyboard.type('1 Main St');
	await keyboard.press('Tab');
	await waitFor(() => expect(screen.getBy(addCard)).toHaveButtonFocus('Add card'));
	await keyboard.press('Enter');
	expect(await screen.findBy(dialog)).toContainText('Card Details');
	await waitFor(() => expect(screen.getBy(number)).toHaveInputFocus());
	await keyboard.type('4242');
	await waitFor(() => expect(screen.getBy(number)).toContainText('4242'));

	// Reverse Tab wraps inside the modal; forward Tab returns to its first input.
	await keyboard.press('Shift+Tab');
	await waitFor(() => expect(screen.getBy(submit)).toHaveButtonFocus('Submit card'));
	await keyboard.press('Tab');
	await waitFor(() => expect(screen.getBy(number)).toHaveInputFocus());
	await keyboard.press('Shift+Tab');
	await keyboard.press('Enter');
	await waitFor(() => {
		expect(screen.queryBy(dialog)).toBeNull();
		expect(screen.getBy(addCard)).toHaveButtonFocus('Add card');
		expect(screen.getBy(name)).toContainText('Ryan');
		expect(screen.getBy(address)).toContainText('1 Main St');
	});

	await terminal.resize({ columns: 36, rows: 20 });
	await waitFor(() => {
		const form = screen.getBy(delivery);
		expect(form.screen.viewport.columns).toBe(36);
		expect(form.visibleBounds).toEqual(form.bounds);
		expect(form).toContainText('Pizza Delivery');
	});
	await keyboard.press('Tab');
	await waitFor(() => expect(screen.getBy(name)).toHaveInputFocus());
});

test('returns terminal query responses asynchronously and buffers early keyboard input', async () => {
	await using terminal = await createTerminal();
	const chunks: Buffer[] = [];
	await terminal.keyboard.type('a');
	let writing = true;
	terminal.stdin.on('data', (chunk: Buffer) => {
		expect(writing).toBe(false);
		chunks.push(chunk);
	});
	terminal.stdout.write('\x1b[6n'); // Cursor position query, answered by Ghostty.
	writing = false;
	await terminal.waitFor(() => expect(Buffer.concat(chunks).toString()).toBe('a\x1b[1;1R'));
});

test('keeps two applications and their terminal input isolated in the same process', async () => {
	await using left = await createTerminal();
	await using right = await createTerminal();
	await using leftUI = await createUI(left.appIO);
	await using rightUI = await createUI(right.appIO);
	await mountPizza(leftUI.document);
	await mountPizza(rightUI.document);
	left.run(leftUI.main);
	right.run(rightUI.main);

	await left.keyboard.type('Alice');
	expect(await left.screen.findByText('Alice')).toBeVisible();
	expect(right.screen.queryByText('Alice')).toBeNull();
	await right.keyboard.type('Bob');
	expect(await right.screen.findByText('Bob')).toBeVisible();
	expect(left.screen.queryByText('Bob')).toBeNull();
});

test('disposes the UI input loop and cancels pending queries when a test throws', async () => {
	let finished = false;
	let terminal!: Awaited<ReturnType<typeof createTerminal>>;
	let pending!: Promise<unknown>;
	await expect(
		(async () => {
			await using connection = await createTerminal();
			terminal = connection;
			await using ui = await createUI(connection.appIO);
			connection.run(async () => {
				try {
					await ui.main();
				} finally {
					finished = true;
				}
			});
			pending = connection.screen.findByText('never rendered').catch((error) => error);
			throw new TestBodyError('test body failed');
		})(),
	).rejects.toThrow('test body failed');
	expect(finished).toBe(true);
	expect(terminal.stdin.isRaw).toBe(false);
	expect(terminal.stdin.listenerCount('data')).toBe(0);
	expect(await pending).toMatchObject({ code: 'GW_SESSION_CLOSED' });
	await terminal[Symbol.asyncDispose]();
	await expect(terminal.keyboard.type('late')).rejects.toThrow('closed');
});

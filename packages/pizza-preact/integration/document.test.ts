import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-unassigned-import -- Install the existing Ghostwright evidence matchers.
import 'ghostwright/vitest';
import { createUI } from '@clack/ui';
import { createRoot } from '@clack/ui-preact';
import { jsx } from '@clack/ui-preact/jsx-runtime';
import { createTerminal } from '../../../experiments/ghostwright/spikes/in-process.ts';

test('renders and updates text from the linked UI document through the linked TTY', async () => {
	await using terminal = await createTerminal();
	await using ui = await createUI(terminal.appIO);
	terminal.run(ui.main);
	const text = ui.document.createTextNode('Pizza Delivery');
	ui.document.documentElement.appendChild(text);
	expect(await terminal.screen.findByText('Pizza Delivery')).toBeVisible();

	text.data = 'Card Details';
	expect(await terminal.screen.findByText('Card Details')).toBeVisible();
	expect(terminal.screen.queryByText('Pizza Delivery')).toBeNull();
});

test('renders Preact directly into the linked UI document', async () => {
	await using terminal = await createTerminal();
	await using ui = await createUI(terminal.appIO);
	terminal.run(ui.main);
	const container = ui.document.createElement('div');
	ui.document.documentElement.appendChild(container);
	using root = createRoot(container);
	root.render(jsx('span', { children: 'Pizza Delivery' }));
	expect(await terminal.screen.findByText('Pizza Delivery')).toBeVisible();

	root.render(jsx('span', { children: 'Card Details' }));
	expect(await terminal.screen.findByText('Card Details')).toBeVisible();
});

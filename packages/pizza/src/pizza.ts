/**
 * Pizza delivery: a clack/ui form application. A delivery form submits on
 * Enter, which opens the card dialog; the card form submits on Enter, which
 * closes it. No keyboard policy lives in this file — forms own implicit
 * submission, the way they do in the DOM.
 *
 * Run: `tsx src/pizza.ts`
 */
import { stdin, stdout } from 'node:process';
import { fixed, grow, rgba } from '@bomb.sh/tty';
import { createUI, type HostElement } from '@clack/ui';

const black = rgba(0, 0, 0);
const blue = rgba(0, 0, 238);
const cyan = rgba(0, 205, 205);
const gray = rgba(127, 127, 127);

const ui = await createUI({ input: stdin, output: stdout });
const { host } = ui;

// Give the application one explicit, full-screen layout parent. Floating
// children can then attach to this stable surface as the terminal resizes.
const screen = host.createElement('box');
host.setProperty(screen, 'layout', {
	direction: 'ttb',
	width: grow(),
	height: grow(),
});

function button(labelText: string, name: string): HostElement {
	const element = host.createElement('button');
	host.setProperty(element, 'role', 'button');
	host.setProperty(element, 'label', name);
	host.setProperty(element, 'type', 'submit');
	host.setProperty(element, 'layout', {
		width: fixed(16),
		height: fixed(3),
		padding: { top: 1, right: 1, bottom: 1, left: 1 },
	});
	host.setProperty(element, 'border', {
		color: gray,
		top: 1,
		right: 1,
		bottom: 1,
		left: 1,
	});
	host.insertBefore(element, host.createLiteral(labelText));
	return element;
}

function field(name: string): HostElement {
	const element = host.createElement('input');
	host.setProperty(element, 'role', 'textbox');
	host.setProperty(element, 'label', name);
	return element;
}

// --- delivery form ---------------------------------------------------------

const nameInput = field('name');
const addressInput = field('address');

const delivery = host.createElement('form');
host.setProperty(delivery, 'role', 'form');
host.setProperty(delivery, 'label', 'delivery');
host.setProperty(delivery, 'layout', {
	direction: 'ttb',
	gap: 1,
	padding: { top: 1, bottom: 1, left: 2, right: 2 },
	width: grow(32, 44),
});
host.setProperty(delivery, 'border', { color: blue, top: 1, right: 1, bottom: 1, left: 1 });

const header = host.createElement('text');
host.setProperty(header, 'color', cyan);
host.insertBefore(header, host.createLiteral('Pizza Delivery'));
host.insertBefore(delivery, header);

for (const [labelText, element] of [
	['name:', nameInput],
	['address:', addressInput],
] as const) {
	const row = host.createElement('box');
	host.setProperty(row, 'layout', { direction: 'ltr', gap: 1, width: grow() });
	const label = host.createElement('box');
	host.setProperty(label, 'layout', { width: fixed(9) });
	const label2 = host.createElement('text');
	host.setProperty(label2, 'color', gray);
	host.insertBefore(label2, host.createLiteral(labelText));
	host.insertBefore(label, label2);
	host.insertBefore(row, label);
	host.insertBefore(row, element);
	host.insertBefore(delivery, row);
}
const actions = host.createElement('box');
host.setProperty(actions, 'layout', { direction: 'ltr', gap: 1, width: grow() });
host.insertBefore(actions, button('Add card', 'add-card'));
host.insertBefore(delivery, actions);

// --- card dialog -----------------------------------------------------------

const cardNumberInput = field('card-number');
const expiryInput = field('expiry');
const cvcInput = field('cvc');

const cardDialog = host.createElement('dialog');
host.setProperty(cardDialog, 'role', 'dialog');
host.setProperty(cardDialog, 'label', 'card');
host.setProperty(cardDialog, 'modal', true);
host.setProperty(cardDialog, 'layout', {
	direction: 'ttb',
	width: grow(32, 44),
});
host.setProperty(cardDialog, 'bg', black);
host.setProperty(cardDialog, 'border', {
	color: blue,
	top: 1,
	right: 1,
	bottom: 1,
	left: 1,
});
host.setProperty(cardDialog, 'floating', {
	attachTo: 'parent',
	attachPoints: { element: 'center-center', parent: 'center-center' },
	zIndex: 1,
});

const card = host.createElement('form');
host.setProperty(card, 'role', 'form');
host.setProperty(card, 'label', 'card-payment');
host.setProperty(card, 'layout', {
	direction: 'ttb',
	gap: 1,
	padding: { top: 1, bottom: 1, left: 2, right: 2 },
	width: grow(),
});
host.insertBefore(cardDialog, card);

const cardHeader = host.createElement('text');
host.setProperty(cardHeader, 'color', cyan);
host.insertBefore(cardHeader, host.createLiteral('Card Details'));
host.insertBefore(card, cardHeader);

for (const [labelText, element] of [
	['card-number:', cardNumberInput],
	['expiry:', expiryInput],
	['cvc:', cvcInput],
] as const) {
	const row = host.createElement('box');
	host.setProperty(row, 'layout', { direction: 'ltr', gap: 1, width: grow() });
	const label = host.createElement('box');
	host.setProperty(label, 'layout', { width: fixed(13) });
	const label2 = host.createElement('text');
	host.setProperty(label2, 'color', gray);
	host.insertBefore(label2, host.createLiteral(labelText));
	host.insertBefore(label, label2);
	host.insertBefore(row, label);
	host.insertBefore(row, element);
	host.insertBefore(card, row);
}
const cardActions = host.createElement('box');
host.setProperty(cardActions, 'layout', { direction: 'ltr', gap: 1, width: grow() });
host.insertBefore(cardActions, button('Submit card', 'submit-card'));
host.insertBefore(card, cardActions);

// --- behavior: forms submit, the app decides what that means ---------------

let cardOpen = false;

host.addEventListener(delivery, 'submit', () => {
	if (cardOpen) return;
	cardOpen = true;
	host.insertBefore(screen, cardDialog);
});

host.addEventListener(card, 'submit', () => {
	if (!cardOpen) return;
	cardOpen = false;
	host.removeChild(screen, cardDialog);
});

host.insertBefore(screen, delivery);
host.insertBefore(host.element, screen);

await ui.main();

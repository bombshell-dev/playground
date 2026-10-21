import type { Document, Element, StyleDeclaration } from '@clack/ui';

type Style = Partial<Omit<StyleDeclaration, 'values'>>;

/** Mount the delivery form and modal card form in a terminal document. */
export async function mountPizza(document: Document): Promise<void> {
	function element(
		tag: string,
		options: { label?: string; role?: string; style?: Style; text?: string } = {},
	): Element {
		const node = document.createElement(tag);
		if (options.label) node.setAttribute('label', options.label);
		if (options.role) node.setAttribute('role', options.role);
		Object.assign(node.style, options.style);
		if (options.text) node.appendChild(document.createTextNode(options.text));
		return node;
	}
	const root = element('div', {
		style: { width: '100%', height: '100%', flexDirection: 'column' },
	});
	function button(text: string, label: string): Element {
		const node = element('button', {
			label,
			role: 'button',
			text,
			style: {
				width: '16px',
				height: '3px',
				borderStyle: 'solid',
				borderColor: '#7f7f7f',
				paddingLeft: '1px',
				paddingRight: '1px',
			},
		});
		node.setAttribute('type', 'submit');
		return node;
	}
	function form(label: string, title: string): Element {
		const node = element('form', {
			label,
			role: 'form',
			style: {
				flexDirection: 'column',
				gap: '1px',
				paddingTop: '1px',
				paddingBottom: '1px',
				paddingLeft: '2px',
				paddingRight: '2px',
				minWidth: '32px',
				maxWidth: '44px',
				borderStyle: 'solid',
				borderColor: '#0000ee',
			},
		});
		node.appendChild(element('span', { text: title, style: { color: '#00cdcd' } }));
		return node;
	}
	function field(parent: Element, options: { label: string; width: number }): void {
		const row = element('div', { style: { width: '100%', gap: '1px' } });
		const caption = element('div', { style: { width: `${options.width}px` } });
		caption.appendChild(
			element('span', { text: `${options.label}:`, style: { color: '#7f7f7f' } }),
		);
		row.appendChild(caption);
		row.appendChild(element('input', { label: options.label, role: 'textbox' }));
		parent.appendChild(row);
	}
	const delivery = form('delivery', 'Pizza Delivery');
	field(delivery, { label: 'name', width: 9 });
	field(delivery, { label: 'address', width: 9 });
	delivery.appendChild(button('Add card', 'add-card'));
	root.appendChild(delivery);
	const dialog = element('dialog', {
		label: 'card',
		role: 'dialog',
		style: {
			minWidth: '32px',
			maxWidth: '44px',
			backgroundColor: '#000000',
			flexDirection: 'column',
		},
	});
	dialog.modal = true;
	const card = form('card-payment', 'Card Details');
	for (const label of ['card-number', 'expiry', 'cvc']) field(card, { label, width: 13 });
	card.appendChild(button('Submit card', 'submit-card'));
	dialog.appendChild(card);
	delivery.addEventListener('submit', () => {
		if (!dialog.isConnected) root.appendChild(dialog);
	});
	card.addEventListener('submit', () => dialog.remove());
	document.documentElement.appendChild(root);
}

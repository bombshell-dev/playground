import { LitElement, html } from 'lit';

// This browser-targeted module is instantiated inside an explicit FixtureRealm.
export const lifecycle = [];

export class Counter extends LitElement {
	static properties = { count: { type: Number, reflect: true } };

	constructor() {
		super();
		this.count = 0;
	}

	connectedCallback() {
		super.connectedCallback();
		lifecycle.push('connected');
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		lifecycle.push('disconnected');
	}

	render() {
		return html`<box
			><button
				@click=${() => {
					this.count += 1;
				}}
			>
				${this.count}</button
			><slot></slot
		></box>`;
	}
}

customElements.define('terminal-counter', Counter);

export const counter = new Counter();
counter.appendChild(document.createTextNode('light content'));

export async function mount() {
	document.documentElement.appendChild(counter);
	await counter.updateComplete;
}

export async function setCount(count) {
	await Promise.resolve();
	counter.count = count;
	await counter.updateComplete;
}

export async function attributeCount(count) {
	counter.setAttribute('count', String(count));
	await counter.updateComplete;
}

export function remove() {
	counter.remove();
}

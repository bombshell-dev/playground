// oxlint-disable bombshell-dev/exported-function-async -- This is an internal synchronous adapter factory.
import type { Host } from '@clack/ui';
import type { HostElement, HostElementChild, HostLiteral } from '@clack/ui/elements';
import type { HostEventListener, HostEventType } from '@clack/ui/events';

type PreactNode = PreactElementNode | PreactTextNode;

interface HostAttribute {
	readonly name: string;
	readonly value: unknown;
}

export interface ElementHandle {
	/** The framework-neutral element represented by this Preact host instance. */
	readonly element: HostElement;
}

/** Create the DOM-shaped container Preact uses to mutate a Host. */
export function createContainer(host: Host, element: HostElement): ElementHandle {
	const document = new HostDocument(host);
	return document.wrap(element) as PreactElementNode;
}

const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const hostChild = Symbol('host child');

class HostDocument {
	readonly #instances = new WeakMap<HostElementChild, PreactNode>();
	readonly host: Host;

	constructor(host: Host) {
		this.host = host;
	}

	createElementNS(_namespace: string | null, name: string): PreactElementNode {
		return this.wrap(this.host.createElement(name)) as PreactElementNode;
	}

	createTextNode(content: string): PreactTextNode {
		return this.wrap(this.host.createLiteral(String(content))) as PreactTextNode;
	}

	wrap(child: HostElementChild): PreactNode {
		const existing = this.#instances.get(child);
		if (existing) return existing;

		const instance =
			child.type === 'element'
				? new PreactElementNode(this, child)
				: new PreactTextNode(this, child);
		this.#instances.set(child, instance);
		return instance;
	}
}

abstract class PreactNodeBase<Child extends HostElementChild> {
	abstract readonly nodeType: number;
	readonly ownerDocument: HostDocument;
	readonly [hostChild]: Child;

	constructor(ownerDocument: HostDocument, child: Child) {
		this.ownerDocument = ownerDocument;
		this[hostChild] = child;
	}

	get parentNode(): PreactElementNode | null {
		const parent = this[hostChild].parent;
		return parent ? (this.ownerDocument.wrap(parent) as PreactElementNode) : null;
	}

	get nextSibling(): PreactNode | null {
		const parent = this[hostChild].parent;
		if (!parent) return null;

		const index = parent.children.indexOf(this[hostChild]);
		const sibling = parent.children[index + 1];
		return sibling ? this.ownerDocument.wrap(sibling) : null;
	}

	remove(): void {
		const parent = this[hostChild].parent;
		if (parent) this.ownerDocument.host.removeChild(parent, this[hostChild]);
	}
}

class PreactElementNode extends PreactNodeBase<HostElement> implements ElementHandle {
	readonly #listeners = new WeakMap<(event: unknown) => void, HostEventListener<HostEventType>>();
	readonly nodeType = 1;
	readonly namespaceURI = XHTML_NAMESPACE;
	_children?: unknown;

	get element(): HostElement {
		return this[hostChild];
	}

	get localName(): string {
		return this.element.name;
	}

	get attributes(): readonly HostAttribute[] {
		return Object.entries(this.element.properties).map(([name, value]) => ({ name, value }));
	}

	get childNodes(): PreactNode[] {
		return this.element.children.map((child) => this.ownerDocument.wrap(child));
	}

	get firstChild(): PreactNode | null {
		const child = this.element.children[0];
		return child ? this.ownerDocument.wrap(child) : null;
	}

	setAttribute(name: string, value: unknown): void {
		this.ownerDocument.host.setProperty(this.element, name, value);
	}

	removeAttribute(name: string): void {
		this.ownerDocument.host.setProperty(this.element, name, undefined);
	}

	insertBefore(child: PreactNode, anchor: PreactNode | null): PreactNode {
		this.ownerDocument.host.insertBefore(this.element, child[hostChild], anchor?.[hostChild]);
		return child;
	}

	appendChild(child: PreactNode): PreactNode {
		return this.insertBefore(child, null);
	}

	removeChild(child: PreactNode): PreactNode {
		this.ownerDocument.host.removeChild(this.element, child[hostChild]);
		return child;
	}

	addEventListener(type: string, listener: (event: unknown) => void): void {
		let wrapped = this.#listeners.get(listener);
		if (!wrapped) {
			wrapped = (event) => listener.call(this, event);
			this.#listeners.set(listener, wrapped);
		}
		this.ownerDocument.host.addEventListener(this.element, type as HostEventType, wrapped);
	}

	removeEventListener(type: string, listener: (event: unknown) => void): void {
		const wrapped = this.#listeners.get(listener);
		if (!wrapped) return;
		this.ownerDocument.host.removeEventListener(this.element, type as HostEventType, wrapped);
	}
}

class PreactTextNode extends PreactNodeBase<HostLiteral> {
	readonly nodeType = 3;

	get data(): string {
		return this[hostChild].content;
	}

	set data(content: string) {
		this.ownerDocument.host.setText(this[hostChild], String(content));
	}
}

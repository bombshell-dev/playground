/* oxlint-disable bombshell-dev/exported-function-async -- DOM focus eligibility and reflected properties are synchronous. */
import {
	Document,
	Element,
	HTMLSlotElement,
	type Node,
	ShadowRoot,
	getAssignedSlot,
	getShadowRoot,
} from './dom.ts';
import { FocusEvent, KeyboardEvent, type KeyboardEventInit } from './events.ts';

function parentAcrossShadow(node: Node): Node | null {
	return (
		getAssignedSlot(node) ?? node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)
	);
}

function shadowContains(ancestor: Node, node: Node): boolean {
	for (let current: Node | null = node; current; current = parentAcrossShadow(current)) {
		if (current === ancestor) return true;
	}
	return false;
}

function shadowIncludingContains(ancestor: Node, node: Node): boolean {
	for (
		let current: Node | null = node;
		current;
		current = current.parentNode ?? (current instanceof ShadowRoot ? current.host : null)
	) {
		if (current === ancestor) return true;
	}
	return false;
}

/** Logical headless eligibility, without CSS visibility or geometry checks. */
export function isFocusable(element: Element): boolean {
	if (!element.isConnected) return false;
	if (getShadowRoot(element)?.delegatesFocus) return false;
	const nativeControl = ['button', 'input', 'select', 'textarea', 'option', 'optgroup'].includes(
		element.localName,
	);
	for (let current: Node | null = element; current; current = parentAcrossShadow(current)) {
		if (!(current instanceof Element)) continue;
		if (
			current.parentNode instanceof Element &&
			getShadowRoot(current.parentNode) &&
			!getAssignedSlot(current)
		)
			return false;
		if (current.hasAttribute('hidden') || current.hasAttribute('inert')) return false;
		if (
			nativeControl &&
			current.localName === 'fieldset' &&
			current.hasAttribute('disabled') &&
			current.contains(element)
		) {
			const legend = current.children.find((child) => child.localName === 'legend');
			if (!legend?.contains(element)) return false;
		}
	}
	if (nativeControl && element.hasAttribute('disabled')) return false;
	if (element.localName === 'input' && element.getAttribute('type')?.toLowerCase() === 'hidden')
		return false;
	if (explicitTabIndex(element) !== null) return true;
	if (['input', 'button', 'select', 'textarea'].includes(element.localName)) return true;
	if (['a', 'area'].includes(element.localName) && element.hasAttribute('href')) return true;
	const editable = element.getAttribute('contenteditable')?.toLowerCase();
	return editable === '' || editable === 'true' || editable === 'plaintext-only';
}

/** Reflected tabindex default for the supported headless focusable elements. */
export function defaultTabIndex(element: Element): number {
	const explicit = explicitTabIndex(element);
	if (explicit !== null && explicit >= -2147483648 && explicit <= 2147483647) return explicit;
	return [
		'a',
		'area',
		'input',
		'button',
		'select',
		'textarea',
		'frame',
		'iframe',
		'object',
	].includes(element.localName)
		? 0
		: -1;
}

function explicitTabIndex(element: Element): number | null {
	const value = element.getAttribute('tabindex');
	if (value === null || !/^[\t\n\f\r ]*[+-]?\d+/.test(value)) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

/** Independent focus state and logical navigation for one document. */
export class FocusManager {
	readonly #document: Document;
	#active: Element | null = null;
	#transition = 0;

	constructor(document: Document) {
		this.#document = document;
	}

	/** The focused element inside shadow trees, without retargeting to a host. */
	get activeElement(): Element | null {
		return this.#active;
	}

	activeElementFor(root: Document | ShadowRoot): Element | null {
		let active = this.#active;
		if (!active) return root instanceof Document ? (root.body ?? root.documentElement) : null;
		while (active.getRootNode() !== root) {
			const activeRoot = active.getRootNode();
			if (!(activeRoot instanceof ShadowRoot)) return null;
			active = activeRoot.host;
		}
		return active;
	}

	focus(element: Element | null): void {
		if (element && element.ownerDocument !== this.#document) return;
		if (element) {
			const shadow = getShadowRoot(element);
			if (shadow?.delegatesFocus) {
				element =
					this.#active && shadowIncludingContains(element, this.#active)
						? this.#active
						: (this.#delegate(shadow) ?? element);
			}
			if (!isFocusable(element)) return;
		}
		if (element === this.#active) return;
		const previous = this.#active;
		const transition = ++this.#transition;
		this.#active = null;
		if (previous) {
			this.#invalidate(previous);
			previous.dispatchEvent(new FocusEvent('blur', { relatedTarget: element, composed: true }));
			if (transition !== this.#transition) return;
			previous.dispatchEvent(
				new FocusEvent('focusout', { relatedTarget: element, bubbles: true, composed: true }),
			);
			if (transition !== this.#transition) return;
		}
		if (!element || !isFocusable(element)) return;
		this.#active = element;
		this.#invalidate(element);
		element.dispatchEvent(new FocusEvent('focus', { relatedTarget: previous, composed: true }));
		if (transition !== this.#transition || this.#active !== element) return;
		element.dispatchEvent(
			new FocusEvent('focusin', { relatedTarget: previous, bubbles: true, composed: true }),
		);
	}

	blur(element: Element): void {
		const shadow = getShadowRoot(element);
		if (
			this.#active === element ||
			(shadow?.delegatesFocus && this.#active && shadowIncludingContains(shadow, this.#active))
		)
			this.focus(null);
	}

	#delegate(root: ShadowRoot): Element | null {
		const elements: Element[] = [];
		const visit = (node: Node): void => {
			for (const child of node.childNodes) {
				if (child instanceof Element) elements.push(child);
				visit(child);
			}
		};
		visit(root);
		const resolve = (element: Element): Element | null => {
			if (isFocusable(element)) return element;
			const shadow = getShadowRoot(element);
			return shadow?.delegatesFocus ? this.#delegate(shadow) : null;
		};
		for (const element of elements) {
			if (!element.hasAttribute('autofocus')) continue;
			const result = resolve(element);
			if (result) return result;
		}
		for (const element of elements) {
			const result = resolve(element);
			if (result) return result;
		}
		return null;
	}

	/** Removing focused content fixes focus without manufacturing blur events. */
	removing(node: Node): void {
		if (this.#active && shadowContains(node, this.#active)) {
			const previous = this.#active;
			this.#active = null;
			this.#transition++;
			this.#invalidate(previous);
		}
	}

	/** Called after eligibility-affecting attributes change. */
	revalidate(): void {
		if (this.#active && !isFocusable(this.#active)) this.focus(null);
	}

	focusableElements(): readonly Element[] {
		return Object.freeze(this.#scope(this.#document));
	}

	/** Moves through the logical order, wrapping at either end of the document. */
	moveFocus(backward = false): Element | null {
		const candidates = this.focusableElements();
		if (!candidates.length) return null;
		const current = this.#active ? candidates.indexOf(this.#active) : -1;
		if (current < 0 && this.#active) {
			const tree = this.#collect(this.#document);
			const position = tree.indexOf(this.#active);
			const search = backward ? tree.slice(0, position).toReversed() : tree.slice(position + 1);
			const next = search.find((element) => candidates.includes(element));
			if (next) {
				this.focus(next);
				return this.#active;
			}
		}
		const next =
			current < 0
				? backward
					? candidates.length - 1
					: 0
				: (current + (backward ? -1 : 1) + candidates.length) % candidates.length;
		const element = candidates[next] ?? null;
		this.focus(element);
		return this.#active;
	}

	#scope(root: Document | ShadowRoot | HTMLSlotElement): Element[] {
		const scope: Element[] = [];
		const visit = (children: readonly Node[]): void => {
			for (const child of children) {
				if (!(child instanceof Element)) continue;
				const isOwner = getShadowRoot(child) !== null || child instanceof HTMLSlotElement;
				if (isOwner || isFocusable(child)) {
					if ((explicitTabIndex(child) ?? 0) >= 0) scope.push(child);
				}
				if (!isOwner) visit(child.childNodes);
			}
		};
		if (root instanceof HTMLSlotElement) {
			const assigned = root.assignedNodes();
			visit(assigned.length ? assigned : root.childNodes);
		} else visit(root.childNodes);
		const ordered = scope.toSorted(
			(a, b) => (explicitTabIndex(a) || Infinity) - (explicitTabIndex(b) || Infinity),
		);
		return ordered.flatMap((element) => {
			const shadow = getShadowRoot(element);
			const inside = shadow
				? this.#scope(shadow)
				: element instanceof HTMLSlotElement
					? this.#scope(element)
					: [];
			return isFocusable(element) ? [element, ...inside] : inside;
		});
	}

	#collect(root: Node): Element[] {
		const elements: Element[] = [];
		const children =
			root instanceof HTMLSlotElement ? root.assignedNodes({ flatten: true }) : root.childNodes;
		for (const child of children) {
			if (!(child instanceof Element)) continue;
			elements.push(child);
			const shadow = getShadowRoot(child);
			elements.push(...this.#collect(shadow ?? child));
		}
		return elements;
	}

	#invalidate(element: Element): void {
		if (element.isConnected) this.#document.invalidate({ kind: 'focus', target: element });
	}
}

/** Input from a terminal/other host, distinct from a dispatched DOM event. */
export interface KeyInput extends Omit<KeyboardEventInit, 'bubbles' | 'cancelable' | 'composed'> {
	key: string;
}

/** Host input boundary. It routes keys and performs explicit logical Tab navigation. */
export class Dispatch {
	readonly #document: Document;

	constructor(document: Document) {
		this.#document = document;
	}

	keydown(input: KeyInput): boolean {
		const accepted = this.#key('keydown', input);
		if (accepted && input.key === 'Tab' && !input.altKey && !input.ctrlKey && !input.metaKey) {
			this.#document.focusManager.moveFocus(Boolean(input.shiftKey));
		}
		return accepted;
	}

	keyup(input: KeyInput): boolean {
		return this.#key('keyup', input);
	}

	#key(type: 'keydown' | 'keyup', input: KeyInput): boolean {
		this.#document.focusManager.revalidate();
		const target =
			this.#document.focusManager.activeElement ??
			this.#document.body ??
			this.#document.documentElement ??
			this.#document;
		return target.dispatchEvent(
			new KeyboardEvent(type, { ...input, bubbles: true, cancelable: true, composed: true }),
		);
	}
}

/* oxlint-disable bombshell-dev/exported-function-async -- Element algorithms and DOM accessors are synchronous. */
import {
	type Document,
	Element,
	HTML_NAMESPACE,
	Node,
	ShadowRoot,
	getAssignedSlot,
	getShadowRoot,
} from './dom.ts';
import { Event, ToggleEvent, type EventTarget } from './events.ts';
import { isFocusable } from './focus.ts';
import { subscribeMutations } from './hooks.ts';

interface DialogState {
	modal: boolean;
	previous: Element | null;
	returnValue: string;
	closing: boolean;
	requesting: boolean;
}
export interface DetailsElement extends Element {
	open: boolean;
	name: string;
}
export interface DialogElement extends Element {
	open: boolean;
	returnValue: string;
	closedBy: string;
	show(): void;
	showModal(): void;
	close(returnValue?: string): void;
	requestClose(returnValue?: string): void;
}
interface InteractiveElementConstructors {
	HTMLDetailsElement: new (document: Document) => DetailsElement;
	HTMLSummaryElement: new (document: Document) => Element;
	HTMLDialogElement: new (document: Document) => DialogElement;
}
const dialogs = new WeakMap<Element, DialogState>();
const modalStacks = new WeakMap<Document, Element[]>();
const openDialogs = new WeakMap<Document, Element[]>();
const toggles = new WeakMap<
	Element,
	{ oldState: string; newState: string; timer: ReturnType<typeof setTimeout> }
>();

function parent(node: Node): Node | null {
	return (
		getAssignedSlot(node) ?? node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)
	);
}

function contains(ancestor: Node, node: Node): boolean {
	for (let current: Node | null = node; current; current = parent(current)) {
		if (current === ancestor) return true;
	}
	return false;
}

function descendants(root: Node): Element[] {
	const result: Element[] = [];
	for (const child of root.childNodes) {
		if (!(child instanceof Element)) continue;
		result.push(child, ...descendants(child));
	}
	return result;
}

function shadowDescendants(root: Node): Element[] {
	const result: Element[] = [];
	const shadow = root instanceof Element ? getShadowRoot(root) : null;
	if (shadow) result.push(...shadowDescendants(shadow));
	for (const child of root.childNodes) {
		if (!(child instanceof Element)) continue;
		result.push(child, ...shadowDescendants(child));
	}
	return result;
}

function queueToggle(element: Element, transition: { oldState: string; newState: string }): void {
	const previous = toggles.get(element);
	if (previous) clearTimeout(previous.timer);
	const task = {
		oldState: previous?.oldState ?? transition.oldState,
		newState: transition.newState,
		timer: setTimeout(() => {
			toggles.delete(element);
			element.dispatchEvent(
				new ToggleEvent('toggle', { oldState: task.oldState, newState: task.newState }),
			);
		}, 0),
	};
	toggles.set(element, task);
}

function firstSummary(details: Element): Element | undefined {
	return details.children.find(
		(child) => child.namespaceURI === HTML_NAMESPACE && child.localName === 'summary',
	);
}

/** @internal Only the first summary child supplies the disclosure control. */
export function isSummary(element: Element): boolean {
	return (
		element.namespaceURI === HTML_NAMESPACE &&
		element.localName === 'summary' &&
		element.parentElement?.namespaceURI === HTML_NAMESPACE &&
		element.parentElement?.localName === 'details' &&
		firstSummary(element.parentElement) === element
	);
}

/** @internal Logical inertness, including the document's topmost modal dialog. */
export function isInteractionInert(element: Element): boolean {
	const modal = modalStacks.get(element.ownerDocument)?.at(-1);
	if (modal && !contains(modal, element)) return true;
	for (let current: Node | null = element; current; current = parent(current)) {
		if (current instanceof Element && current.hasAttribute('inert')) return true;
		if (current === modal) break;
	}
	return false;
}

/** @internal Widget state contributes to logical visibility without a CSS engine. */
export function isClosedWidgetContent(element: Element): boolean {
	for (let current: Node | null = element; current; current = parent(current)) {
		if (!(current instanceof Element) || current.namespaceURI !== HTML_NAMESPACE) continue;
		if (current.localName === 'dialog' && !current.hasAttribute('open')) return true;
		if (current !== element && current.localName === 'details' && !current.hasAttribute('open')) {
			const summary = firstSummary(current);
			if (!summary || !contains(summary, element)) return true;
		}
	}
	return false;
}

function ensureExclusive(element: Element, opening: boolean): void {
	const name = element.getAttribute('name');
	if (!name || !element.hasAttribute('open')) return;
	const root = element.getRootNode();
	const peers = [...(root instanceof Element ? [root] : []), ...descendants(root)];
	for (const peer of peers) {
		if (
			peer === element ||
			peer.namespaceURI !== HTML_NAMESPACE ||
			peer.localName !== 'details' ||
			peer.getAttribute('name') !== name ||
			!peer.hasAttribute('open')
		)
			continue;
		if (opening) peer.removeAttribute('open');
		else {
			element.removeAttribute('open');
			return;
		}
	}
}

/** @internal Called by click activation after cancellation has been checked. */
export function activateInteractive(element: Element, target: EventTarget | null): boolean {
	if (!isSummary(element)) return false;
	for (
		let current =
			target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
		current instanceof Element && current !== element;
		current = current.parentElement
	) {
		if (
			current.namespaceURI === HTML_NAMESPACE &&
			(['button', 'input', 'select', 'textarea', 'summary'].includes(current.localName) ||
				(current.localName === 'a' && current.hasAttribute('href')))
		)
			return true;
	}
	element.parentElement?.toggleAttribute('open');
	return true;
}

function dialogState(element: Element): DialogState {
	const state = dialogs.get(element);
	if (!state) throw new DOMException('Expected a dialog element', 'InvalidStateError');
	return state;
}

function registerOpen(element: Element): void {
	if (!element.isConnected || !element.hasAttribute('open')) return;
	const document = element.ownerDocument;
	let list = openDialogs.get(document);
	if (!list) {
		list = [];
		openDialogs.set(document, list);
	}
	if (!list.includes(element)) list.push(element);
}

function removeFrom(list: Element[] | undefined, element: Element): void {
	const index = list?.indexOf(element) ?? -1;
	if (index >= 0) list?.splice(index, 1);
}

function closeDialog(element: Element, result?: string): void {
	const state = dialogState(element);
	if (!element.hasAttribute('open') || state.closing) return;
	state.closing = true;
	try {
		element.dispatchEvent(
			new ToggleEvent('beforetoggle', { oldState: 'open', newState: 'closed' }),
		);
		if (!element.hasAttribute('open')) return;
		const document = element.ownerDocument;
		const active = document.focusManager.activeElement;
		const restore = state.modal || Boolean(active && contains(element, active));
		queueToggle(element, { oldState: 'open', newState: 'closed' });
		element.removeAttribute('open');
		removeFrom(modalStacks.get(document), element);
		state.modal = false;
		if (result !== undefined) state.returnValue = String(result);
		const previous = state.previous;
		state.previous = null;
		if (restore && previous) previous.focus();
		document.focusManager.revalidate();
		setTimeout(() => element.dispatchEvent(new Event('close')), 0);
	} finally {
		state.closing = false;
	}
}

function requestClose(element: Element, result?: string): void {
	const state = dialogState(element);
	if (!element.isConnected || !element.hasAttribute('open') || state.requesting) return;
	state.requesting = true;
	try {
		if (element.dispatchEvent(new Event('cancel', { cancelable: true })))
			closeDialog(element, result);
	} finally {
		state.requesting = false;
	}
}

/** @internal Escape closes the last eligible open dialog; requestClose ignores closedby. */
export function requestDialogClose(document: Document): boolean {
	const element = openDialogs.get(document)?.at(-1);
	if (!element) return false;
	const value = element.getAttribute('closedby')?.toLowerCase();
	if (
		value === 'none' ||
		(!['any', 'closerequest'].includes(value ?? '') && !dialogState(element).modal)
	)
		return false;
	requestClose(element);
	return true;
}

function showDialog(element: Element, modal: boolean): void {
	const state = dialogState(element);
	if (element.hasAttribute('open')) {
		if (state.modal !== modal)
			throw new DOMException('The dialog is already open in a different mode', 'InvalidStateError');
		return;
	}
	if (modal && !element.isConnected)
		throw new DOMException('A modal dialog must be connected', 'InvalidStateError');
	if (
		!element.dispatchEvent(
			new ToggleEvent('beforetoggle', { oldState: 'closed', newState: 'open', cancelable: true }),
		)
	)
		return;
	if (element.hasAttribute('open') || (modal && !element.isConnected)) return;
	const document = element.ownerDocument;
	state.previous = document.focusManager.activeElement;
	queueToggle(element, { oldState: 'closed', newState: 'open' });
	element.setAttribute('open', '');
	state.modal = modal;
	if (modal) {
		let stack = modalStacks.get(document);
		if (!stack) {
			stack = [];
			modalStacks.set(document, stack);
		}
		removeFrom(stack, element);
		stack.push(element);
	}
	const candidates = shadowDescendants(element).filter(isFocusable);
	const focus = element.hasAttribute('autofocus')
		? element
		: (candidates.find((child) => child.hasAttribute('autofocus')) ?? candidates[0] ?? element);
	focus.focus();
	document.focusManager.revalidate();
}

/** @internal Define subclasses after the shared Element base has initialized. */
export function defineInteractiveElements(
	ElementBase: typeof Element,
): InteractiveElementConstructors {
	class HTMLDetailsElement extends ElementBase {
		constructor(document: Document) {
			super('details', document);
		}
		get open(): boolean {
			return this.hasAttribute('open');
		}
		set open(value: boolean) {
			this.toggleAttribute('open', Boolean(value));
		}
		get name(): string {
			return this.getAttribute('name') ?? '';
		}
		set name(value: string) {
			this.setAttribute('name', value);
		}
	}
	class HTMLSummaryElement extends ElementBase {
		constructor(document: Document) {
			super('summary', document);
		}
	}
	class HTMLDialogElement extends ElementBase {
		constructor(document: Document) {
			super('dialog', document);
			dialogs.set(this, {
				modal: false,
				previous: null,
				returnValue: '',
				closing: false,
				requesting: false,
			});
		}
		get open(): boolean {
			return this.hasAttribute('open');
		}
		set open(value: boolean) {
			this.toggleAttribute('open', Boolean(value));
		}
		get returnValue(): string {
			return dialogState(this).returnValue;
		}
		set returnValue(value: string) {
			dialogState(this).returnValue = String(value);
		}
		get closedBy(): string {
			const value = this.getAttribute('closedby')?.toLowerCase();
			return value && ['any', 'closerequest', 'none'].includes(value)
				? value
				: dialogState(this).modal
					? 'closerequest'
					: 'none';
		}
		set closedBy(value: string) {
			this.setAttribute('closedby', value);
		}
		show(): void {
			showDialog(this, false);
		}
		showModal(): void {
			showDialog(this, true);
		}
		close(returnValue?: string): void {
			closeDialog(this, returnValue);
		}
		requestClose(returnValue?: string): void {
			requestClose(this, returnValue);
		}
	}
	return { HTMLDetailsElement, HTMLSummaryElement, HTMLDialogElement };
}

subscribeMutations((record) => {
	if (
		record.type === 'attributes' &&
		record.target instanceof Element &&
		!record.attributeNamespace
	) {
		const element = record.target;
		if (element.namespaceURI === HTML_NAMESPACE && element.localName === 'details') {
			if (record.attributeName === 'name') ensureExclusive(element, false);
			if (
				record.attributeName === 'open' &&
				(record.oldValue === null) !== !element.hasAttribute('open')
			) {
				queueToggle(element, {
					oldState: record.oldValue === null ? 'closed' : 'open',
					newState: element.hasAttribute('open') ? 'open' : 'closed',
				});
				ensureExclusive(element, true);
				element.ownerDocument.focusManager.revalidate();
			}
		}
		if (dialogs.has(element) && record.attributeName === 'open') {
			if (element.hasAttribute('open')) registerOpen(element);
			else removeFrom(openDialogs.get(element.ownerDocument), element);
			element.ownerDocument.focusManager.revalidate();
		}
	}
	if (record.type !== 'childList') return;
	for (const removed of record.removedNodes ?? []) {
		const elements = [
			...(removed instanceof Element ? [removed] : []),
			...shadowDescendants(removed),
		];
		for (const element of elements) {
			const state = dialogs.get(element);
			if (!state) continue;
			removeFrom(modalStacks.get(element.ownerDocument), element);
			removeFrom(openDialogs.get(element.ownerDocument), element);
			state.modal = false;
			state.previous = null;
		}
	}
	for (const added of record.addedNodes ?? []) {
		for (const element of [
			...(added instanceof Element ? [added] : []),
			...shadowDescendants(added),
		]) {
			if (element.namespaceURI === HTML_NAMESPACE && element.localName === 'details')
				ensureExclusive(element, false);
			if (dialogs.has(element)) registerOpen(element);
		}
	}
});

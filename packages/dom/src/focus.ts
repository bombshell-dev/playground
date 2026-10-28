/* oxlint-disable bombshell-dev/exported-function-async -- DOM focus eligibility and reflected properties are synchronous. */
import {
	Document,
	Element,
	HTMLSlotElement,
	HTMLInputElement,
	HTMLTextAreaElement,
	Text,
	type Node,
	ShadowRoot,
	getAssignedSlot,
	getShadowRoot,
} from './dom.ts';
import { Event, FocusEvent, InputEvent, KeyboardEvent, type KeyboardEventInit } from './events.ts';
import {
	isClosedWidgetContent,
	isInteractionInert,
	isSummary,
	requestDialogClose,
} from './interactive-elements.ts';
import { markControlUserEdited, radioGroup } from './controls.ts';
import { implicitSubmit, isDisabled } from './forms.ts';
import { changeSelectSelection, handleSelectKey } from './value-elements.ts';
import { subscribeMutations } from './hooks.ts';

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
	if (isInteractionInert(element) || isClosedWidgetContent(element)) return false;
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
		if (current.hasAttribute('hidden')) return false;
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
	if (isSummary(element) || element.localName === 'dialog') return true;
	if (['a', 'area'].includes(element.localName) && element.hasAttribute('href')) return true;
	return element.isContentEditable && !element.parentElement?.isContentEditable;
}

/** Reflected tabindex default for the supported headless focusable elements. */
export function defaultTabIndex(element: Element): number {
	const explicit = explicitTabIndex(element);
	if (explicit !== null && explicit >= -2147483648 && explicit <= 2147483647) return explicit;
	if (
		isSummary(element) ||
		(element.isContentEditable && !element.parentElement?.isContentEditable)
	)
		return 0;
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
	#autofocusProcessed = false;

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
			commitControl(previous);
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

	/** Process connected autofocus candidates once, after synchronous tree preparation. */
	processAutofocus(): void {
		if (this.#autofocusProcessed) return;
		if (this.#active) {
			this.#autofocusProcessed = true;
			return;
		}
		const candidate = this.#collect(this.#document).find(
			(element) => element.hasAttribute('autofocus') && isFocusable(element),
		);
		if (!candidate) return;
		this.#autofocusProcessed = true;
		this.focus(candidate);
	}

	focusableElements(): readonly Element[] {
		return Object.freeze(
			this.#scope(this.#document).filter((element) => {
				if (!(element instanceof HTMLInputElement) || element.type !== 'radio') return true;
				const group = radioGroup(element).filter(isFocusable);
				return element === (group.find((member) => member.checked) ?? group[0]);
			}),
		);
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
					if ((isOwner ? (explicitTabIndex(child) ?? 0) : child.tabIndex) >= 0) scope.push(child);
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

/** Host input boundary for logical navigation, activation, and control editing. */
export class Dispatch {
	readonly #document: Document;
	#spaceTarget: Element | null = null;

	constructor(document: Document) {
		this.#document = document;
	}

	keydown(input: KeyInput): boolean {
		const target = this.#document.focusManager.activeElement;
		const accepted = this.#key('keydown', input);
		if (!accepted || input.isComposing || this.#document.focusManager.activeElement !== target)
			return accepted;
		if (input.key === 'Tab' && !input.altKey && !input.ctrlKey && !input.metaKey) {
			this.#document.focusManager.moveFocus(Boolean(input.shiftKey));
			return accepted;
		}
		if (input.key === 'Escape' && !input.altKey && !input.ctrlKey && !input.metaKey) {
			requestDialogClose(this.#document);
			return accepted;
		}
		if (!target || !isFocusable(target)) return accepted;
		if (editKey(target, input)) return accepted;
		if (editContentKey(target, input)) return accepted;
		if (input.altKey || input.ctrlKey || input.metaKey) return accepted;
		if (handleSelectKey(target, input.key)) return accepted;
		if (radioKey(target, input.key)) return accepted;
		if (
			input.key === 'Enter' &&
			target instanceof HTMLInputElement &&
			!activationKeyTarget(target)
		) {
			commitControl(target);
			implicitSubmit(target);
		}
		if (input.key === ' ' && activationKeyTarget(target)) {
			if (!input.repeat) this.#spaceTarget = target;
		}
		if (
			input.key === 'Enter' &&
			activationKeyTarget(target) &&
			!(target instanceof HTMLInputElement && ['checkbox', 'radio'].includes(target.type))
		)
			target.click();
		return accepted;
	}

	keyup(input: KeyInput): boolean {
		const accepted = this.#key('keyup', input);
		if (input.key === ' ') {
			const target = this.#spaceTarget;
			this.#spaceTarget = null;
			if (
				accepted &&
				target &&
				target === this.#document.focusManager.activeElement &&
				isFocusable(target)
			)
				target.click();
		}
		return accepted;
	}

	/** Insert host text (including paste), without pretending to dispatch a trusted key. */
	insertText(text: string): boolean {
		const target = this.#document.focusManager.activeElement;
		if (!target || !isFocusable(target)) return false;
		return isTextControl(target)
			? replaceSelection(target, String(text), 'insertText')
			: replaceEditableSelection(target, { text: String(text), inputType: 'insertText' });
	}

	/** Commit host option selection, for example from a consumer's picker UI. */
	select(indices: readonly number[]): boolean {
		const target = this.#document.focusManager.activeElement;
		return target && isFocusable(target) ? changeSelectSelection(target, indices) : false;
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

type TextControl = HTMLInputElement | HTMLTextAreaElement;
const editedValues = new WeakMap<Element, string>();

function commitControl(element: Element): void {
	const initial = editedValues.get(element);
	editedValues.delete(element);
	if (initial !== undefined && isTextControl(element) && element.value !== initial)
		element.dispatchEvent(new Event('change', { bubbles: true }));
}

function radioKey(element: Element, key: string): boolean {
	if (
		!(element instanceof HTMLInputElement) ||
		element.type !== 'radio' ||
		!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)
	)
		return false;
	const group = radioGroup(element).filter(isFocusable);
	if (!group.length) return true;
	const step = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
	const next = group[(group.indexOf(element) + step + group.length) % group.length];
	if (next) {
		next.focus();
		next.click();
	}
	return true;
}

function isTextControl(element: Element): element is TextControl {
	return (
		(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
		element.selectionStart !== null
	);
}

function activationKeyTarget(element: Element): boolean {
	return (
		element.localName === 'button' ||
		isSummary(element) ||
		(element instanceof HTMLInputElement &&
			['button', 'submit', 'reset', 'checkbox', 'radio'].includes(element.type))
	);
}

// oxlint-disable-next-line bombshell-dev/max-params -- Editing operation carries control, replacement, input kind, and optional explicit range.
function replaceSelection(
	control: TextControl,
	text: string,
	inputType: string,
	range?: { start: number; end: number },
): boolean {
	if (control.hasAttribute('readonly') || isDisabled(control)) return false;
	const start = range?.start ?? control.selectionStart ?? 0;
	const end = range?.end ?? control.selectionEnd ?? 0;
	const normalized =
		control instanceof HTMLTextAreaElement
			? text.replace(/\r\n?/g, '\n')
			: text.replace(/[\r\n]/g, '');
	let replacement = normalized;
	const maximum = control.getAttribute('maxlength');
	if (maximum !== null && /^\d+$/.test(maximum)) {
		const available = Math.max(0, Number(maximum) - (control.value.length - (end - start)));
		replacement = normalized.slice(0, available);
		if (replacement && /[\uD800-\uDBFF]$/.test(replacement)) replacement = replacement.slice(0, -1);
	}
	if (!replacement && start === end) return true;
	const data = inputType.startsWith('delete') ? null : replacement;
	const before = new InputEvent('beforeinput', {
		bubbles: true,
		composed: true,
		cancelable: true,
		inputType,
		data,
	});
	if (!control.dispatchEvent(before)) return false;
	if (
		!isFocusable(control) ||
		control.hasAttribute('readonly') ||
		isDisabled(control) ||
		control.ownerDocument.focusManager.activeElement !== control
	)
		return false;
	if (!editedValues.has(control)) editedValues.set(control, control.value);
	control.setRangeText(replacement, start, end, 'end');
	markControlUserEdited(control);
	control.dispatchEvent(
		new InputEvent('input', { bubbles: true, composed: true, inputType, data }),
	);
	return true;
}

function adjacentBoundary(value: string, position: { offset: number; backward: boolean }): number {
	const boundaries = [
		0,
		...Array.from(
			new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value),
			(part) => part.index + part.segment.length,
		),
	];
	return position.backward
		? (boundaries.findLast((boundary) => boundary < position.offset) ?? 0)
		: (boundaries.find((boundary) => boundary > position.offset) ?? value.length);
}

function editKey(element: Element, input: KeyInput): boolean {
	if (!isTextControl(element)) return false;
	if ((input.ctrlKey || input.metaKey) && input.key.toLowerCase() === 'a' && !input.altKey) {
		element.select();
		return true;
	}
	if (input.altKey || input.ctrlKey || input.metaKey) return false;
	const start = element.selectionStart ?? 0;
	const end = element.selectionEnd ?? 0;
	const backward = element.selectionDirection === 'backward';
	if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(input.key)) {
		const anchor = backward ? end : start;
		const current = backward ? start : end;
		let next =
			input.key === 'Home'
				? 0
				: input.key === 'End'
					? element.value.length
					: adjacentBoundary(element.value, {
							offset: current,
							backward: input.key === 'ArrowLeft',
						});
		if (!input.shiftKey && start !== end && ['ArrowLeft', 'ArrowRight'].includes(input.key))
			next = input.key === 'ArrowLeft' ? start : end;
		if (input.shiftKey)
			element.setSelectionRange(
				Math.min(anchor, next),
				Math.max(anchor, next),
				next < anchor ? 'backward' : 'forward',
			);
		else element.setSelectionRange(next, next);
		return true;
	}
	if (input.key === 'Backspace' || input.key === 'Delete') {
		const from =
			start === end && input.key === 'Backspace'
				? adjacentBoundary(element.value, { offset: start, backward: true })
				: start;
		const to =
			start === end && input.key === 'Delete'
				? adjacentBoundary(element.value, { offset: end, backward: false })
				: end;
		replaceSelection(
			element,
			'',
			input.key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward',
			{ start: from, end: to },
		);
		return true;
	}
	if (input.key === 'Enter' && element instanceof HTMLTextAreaElement) {
		replaceSelection(element, '\n', 'insertLineBreak');
		return true;
	}
	if ([...input.key].length === 1) {
		replaceSelection(element, input.key, 'insertText');
		return true;
	}
	return false;
}

function editingHost(element: Element): Element | null {
	if (!element.isContentEditable) return null;
	let host = element;
	while (host.parentElement?.isContentEditable) host = host.parentElement;
	return host.getRootNode() instanceof Document ? host : null;
}

function editableBoundary(host: Element, node: Node): boolean {
	const element = node instanceof Element ? node : node.parentElement;
	return Boolean(element?.isContentEditable && host.contains(node));
}

function hasProtectedContent(host: Element, range: ReturnType<Document['createRange']>): boolean {
	for (const child of host.children) {
		if (!child.isContentEditable && range.intersectsNode(child)) return true;
		if (hasProtectedContent(child, range)) return true;
	}
	return false;
}

function replaceEditableSelection(
	element: Element,
	edit: { text: string; inputType: string },
): boolean {
	const host = editingHost(element);
	if (!host) return false;
	const selection = host.ownerDocument.getSelection();
	if (
		!selection.rangeCount ||
		!host.contains(selection.anchorNode) ||
		!host.contains(selection.focusNode)
	)
		selection.collapse(host, host.childNodes.length);
	if (!selection.rangeCount) return false;
	const range = selection.getRangeAt(0);
	if (
		!editableBoundary(host, range.startContainer) ||
		!editableBoundary(host, range.endContainer) ||
		hasProtectedContent(host, range)
	)
		return false;
	const text = edit.text.replace(/\r\n?/g, '\n');
	if (!text && range.collapsed) return true;
	const data = edit.inputType.startsWith('delete') ? null : text;
	if (
		!host.dispatchEvent(
			new InputEvent('beforeinput', {
				bubbles: true,
				composed: true,
				cancelable: true,
				inputType: edit.inputType,
				data,
			}),
		)
	)
		return false;
	const active = host.ownerDocument.focusManager.activeElement;
	if (
		!active ||
		editingHost(active) !== host ||
		!isFocusable(active) ||
		!editableBoundary(host, range.startContainer) ||
		!editableBoundary(host, range.endContainer) ||
		hasProtectedContent(host, range)
	)
		return false;
	range.deleteContents();
	const container = range.startContainer;
	const offset = range.startOffset;
	if (text) {
		if (container instanceof Text) {
			container.insertData(offset, text);
			selection.collapse(container, offset + text.length);
		} else {
			const added = host.ownerDocument.createTextNode(text);
			container.insertBefore(added, container.childNodes[offset] ?? null);
			selection.collapse(added, text.length);
		}
	} else selection.collapse(container, offset);
	host.dispatchEvent(
		new InputEvent('input', { bubbles: true, composed: true, inputType: edit.inputType, data }),
	);
	return true;
}

function textPoint(host: Element, offset: number): readonly [Node, number] {
	let remaining = offset;
	let last: Text | undefined;
	const visit = (node: Node): readonly [Node, number] | undefined => {
		if (node instanceof Text) {
			last = node;
			if (remaining <= node.length) return [node, remaining];
			remaining -= node.length;
		}
		for (const child of node.childNodes) {
			const found = visit(child);
			if (found) return found;
		}
		return undefined;
	};
	return visit(host) ?? (last ? [last, last.length] : [host, 0]);
}

function editContentKey(element: Element, input: KeyInput): boolean {
	const host = editingHost(element);
	if (!host) return false;
	const selection = host.ownerDocument.getSelection();
	if ((input.ctrlKey || input.metaKey) && input.key.toLowerCase() === 'a' && !input.altKey) {
		selection.selectAllChildren(host);
		return true;
	}
	if (input.altKey || input.ctrlKey || input.metaKey) return false;
	if (!selection.rangeCount || !host.contains(selection.focusNode))
		selection.collapse(host, host.childNodes.length);
	if (!selection.rangeCount) return false;
	const range = selection.getRangeAt(0);
	if (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(input.key)) {
		if (
			!editableBoundary(host, range.startContainer) ||
			!editableBoundary(host, range.endContainer)
		)
			return true;
		const prefix = host.ownerDocument.createRange();
		prefix.selectNodeContents(host);
		const anchor = selection.focusNode;
		if (!anchor) return true;
		prefix.setEnd(anchor, selection.focusOffset);
		const value = host.textContent ?? '';
		const offset = prefix.toString().length;
		const backward = input.key === 'Backspace' || input.key === 'ArrowLeft';
		const next =
			input.key === 'Home'
				? 0
				: input.key === 'End'
					? value.length
					: adjacentBoundary(value, { offset, backward });
		const point = textPoint(host, next);
		if (!editableBoundary(host, point[0])) return true;
		if (input.key === 'Backspace' || input.key === 'Delete') {
			if (range.collapsed) selection.extend(...point);
			replaceEditableSelection(element, {
				text: '',
				inputType: input.key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward',
			});
		} else if (input.shiftKey) selection.extend(...point);
		else if (!range.collapsed && ['ArrowLeft', 'ArrowRight'].includes(input.key)) {
			if (backward) selection.collapseToStart();
			else selection.collapseToEnd();
		} else selection.collapse(...point);
		return true;
	}
	if (input.key === 'Enter') {
		replaceEditableSelection(element, { text: '\n', inputType: 'insertLineBreak' });
		return true;
	}
	if ([...input.key].length === 1) {
		replaceEditableSelection(element, { text: input.key, inputType: 'insertText' });
		return true;
	}
	return false;
}

const autofocusQueued = new WeakSet<Document>();
subscribeMutations((record) => {
	if (record.type !== 'childList' || !record.addedNodes?.length || !record.target.isConnected)
		return;
	const document = record.target instanceof Document ? record.target : record.target.ownerDocument;
	if (!document || autofocusQueued.has(document)) return;
	autofocusQueued.add(document);
	setTimeout(() => {
		autofocusQueued.delete(document);
		document.focusManager.processAutofocus();
	}, 0);
});

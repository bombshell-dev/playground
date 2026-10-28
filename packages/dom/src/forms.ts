/* oxlint-disable bombshell-dev/exported-function-async -- Synchronous HTML form algorithms. */
import {
	Element,
	HTMLFormElement,
	HTMLInputElement,
	HTML_NAMESPACE,
	readonlyCollection,
	type Node,
} from './dom.ts';
import { Event } from './events.ts';

export interface ValidityFlags {
	valueMissing?: boolean;
	typeMismatch?: boolean;
	patternMismatch?: boolean;
	tooLong?: boolean;
	tooShort?: boolean;
	rangeUnderflow?: boolean;
	rangeOverflow?: boolean;
	stepMismatch?: boolean;
	badInput?: boolean;
}

/** Internal control algorithms, registered without retaining documents or detached controls. */
export interface FormControl {
	reset(): void;
	entries(submitter?: Element | null): readonly (readonly [string, string])[];
	validity(): ValidityFlags;
	willValidate(): boolean;
	value?(): string;
}

interface ControlRecord {
	control: FormControl;
	message: string;
	validity: ValidityState;
}
const controls = new WeakMap<Element, ControlRecord>();

/** A live view of a control's current constraints. */
export class ValidityState {
	readonly #element: Element;
	constructor(element: Element) {
		this.#element = element;
	}
	get valueMissing(): boolean {
		return this.#flags.valueMissing ?? false;
	}
	get typeMismatch(): boolean {
		return this.#flags.typeMismatch ?? false;
	}
	get patternMismatch(): boolean {
		return this.#flags.patternMismatch ?? false;
	}
	get tooLong(): boolean {
		return this.#flags.tooLong ?? false;
	}
	get tooShort(): boolean {
		return this.#flags.tooShort ?? false;
	}
	get rangeUnderflow(): boolean {
		return this.#flags.rangeUnderflow ?? false;
	}
	get rangeOverflow(): boolean {
		return this.#flags.rangeOverflow ?? false;
	}
	get stepMismatch(): boolean {
		return this.#flags.stepMismatch ?? false;
	}
	get badInput(): boolean {
		return this.#flags.badInput ?? false;
	}
	get customError(): boolean {
		return Boolean(controls.get(this.#element)?.message);
	}
	get valid(): boolean {
		return !this.customError && !Object.values(this.#flags).some(Boolean);
	}
	get #flags(): ValidityFlags {
		return controls.get(this.#element)?.control.validity() ?? {};
	}
}

export function registerControl(element: Element, control: FormControl): void {
	controls.set(element, { control, message: '', validity: new ValidityState(element) });
}
export function controlState(element: Element): FormControl | undefined {
	return controls.get(element)?.control;
}
export function resetFormControl(element: Element): void {
	controlState(element)?.reset();
}
export function validityFor(element: Element): ValidityState {
	return controls.get(element)?.validity ?? new ValidityState(element);
}
export function setControlValidity(element: Element, message: string): void {
	const record = controls.get(element);
	if (record && record.message !== String(message)) {
		record.message = String(message);
		if (element.isConnected)
			element.ownerDocument.invalidate({ kind: 'mutation', target: element });
	}
}
export function validationMessageFor(element: Element): string {
	const record = controls.get(element);
	if (!record?.control.willValidate() || record.validity.valid) return '';
	if (record.message) return record.message;
	if (record.validity.valueMissing) return 'Please fill out this field.';
	if (record.validity.typeMismatch) return 'Please enter a value of the required type.';
	if (record.validity.patternMismatch) return 'Please match the requested format.';
	if (record.validity.tooLong) return 'Please shorten this text.';
	if (record.validity.tooShort) return 'Please lengthen this text.';
	if (record.validity.rangeUnderflow) return 'The value is below the allowed minimum.';
	if (record.validity.rangeOverflow) return 'The value is above the allowed maximum.';
	if (record.validity.stepMismatch) return 'Please enter a value on the allowed step.';
	return 'Please enter a valid value.';
}
export function validateControl(element: Element, report = false): boolean {
	const record = controls.get(element);
	if (!record?.control.willValidate() || record.validity.valid) return true;
	const uncanceled = element.dispatchEvent(new Event('invalid', { cancelable: true }));
	if (report && uncanceled) element.focus();
	return false;
}

/** Tree-order traversal stays inside one light-tree root, including detached roots. */
export function formTree(root: Node): Element[] {
	const result: Element[] = root instanceof Element ? [root] : [];
	for (const child of root.childNodes) result.push(...formTree(child));
	return result;
}

export function formOwner(element: Element): HTMLFormElement | null {
	if (element.hasAttribute('form') && element.isConnected) {
		const id = element.getAttribute('form');
		if (!id) return null;
		const candidate = formTree(element.getRootNode()).find((node) => node.id === id);
		return isForm(candidate) ? candidate : null;
	}
	for (let parent = element.parentElement; parent; parent = parent.parentElement)
		if (isForm(parent)) return parent;
	return null;
}
function isForm(element: Element | undefined): element is HTMLFormElement {
	return element instanceof HTMLFormElement;
}
export function formControls(form: Element): readonly Element[] {
	return Object.freeze(
		formTree(form.getRootNode()).filter(
			(element) => controls.has(element) && formOwner(element) === form,
		),
	);
}

export function isDisabled(element: Element): boolean {
	if (element.namespaceURI !== HTML_NAMESPACE) return false;
	if (
		['button', 'input', 'select', 'textarea', 'fieldset', 'optgroup', 'option'].includes(
			element.localName,
		) &&
		element.hasAttribute('disabled')
	)
		return true;
	if (
		element.localName === 'option' &&
		element.parentElement?.namespaceURI === HTML_NAMESPACE &&
		element.parentElement?.localName === 'optgroup' &&
		element.parentElement.hasAttribute('disabled')
	)
		return true;
	for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
		if (
			ancestor.namespaceURI !== HTML_NAMESPACE ||
			ancestor.localName !== 'fieldset' ||
			!ancestor.hasAttribute('disabled')
		)
			continue;
		const legend = ancestor.children.find(
			(child) => child.namespaceURI === HTML_NAMESPACE && child.localName === 'legend',
		);
		if (!legend?.contains(element)) return true;
	}
	return false;
}

export function isLabelable(element: Element): boolean {
	return (
		element.namespaceURI === HTML_NAMESPACE &&
		['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea'].includes(
			element.localName,
		) &&
		!(element.localName === 'input' && element.getAttribute('type')?.toLowerCase() === 'hidden')
	);
}
export function labelControl(label: Element): Element | null {
	if (label.hasAttribute('for')) {
		const id = label.getAttribute('for');
		if (!id) return null;
		const candidate = formTree(label.getRootNode()).find((node) => node.id === id);
		return candidate && isLabelable(candidate) ? candidate : null;
	}
	return formTree(label).find((node) => node !== label && isLabelable(node)) ?? null;
}
const labelCollections = new WeakMap<Element, readonly Element[]>();
export function labelsFor(element: Element): readonly Element[] {
	let collection = labelCollections.get(element);
	if (!collection) {
		collection = readonlyCollection(() =>
			formTree(element.getRootNode()).filter(
				(node) =>
					node.namespaceURI === HTML_NAMESPACE &&
					node.localName === 'label' &&
					labelControl(node) === element,
			),
		);
		labelCollections.set(element, collection);
	}
	return collection;
}

/** Descendants of a datalist are barred from constraint validation. */
export function inDatalist(element: Element): boolean {
	for (let parent = element.parentElement; parent; parent = parent.parentElement)
		if (parent.namespaceURI === HTML_NAMESPACE && parent.localName === 'datalist') return true;
	return false;
}

/** Host-driver Enter behavior; synthetic keyboard dispatch does not call this. */
export function implicitSubmit(element: Element): void {
	const form = formOwner(element);
	if (!form) return;
	const listed = formControls(form);
	const submitter = listed.find((control) => {
		const type = control.getAttribute('type')?.toLowerCase() ?? '';
		return control.localName === 'button'
			? !['button', 'reset'].includes(type)
			: control.localName === 'input' && ['submit', 'image'].includes(type);
	});
	if (submitter) {
		if (!isDisabled(submitter)) submitter.click();
		return;
	}
	const blockingTypes = [
		'text',
		'search',
		'tel',
		'url',
		'email',
		'password',
		'date',
		'month',
		'week',
		'time',
		'datetime-local',
		'number',
	];
	if (
		listed.filter(
			(control) => control instanceof HTMLInputElement && blockingTypes.includes(control.type),
		).length < 2
	)
		form.requestSubmit();
}

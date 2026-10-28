/* oxlint-disable bombshell-dev/exported-function-async -- HTML form methods are synchronous. */
import {
	type Document,
	Element,
	Node,
	HTML_NAMESPACE,
	HTMLFormElement as FormClass,
	type HTMLFormElement,
	HTMLButtonElement as ButtonClass,
	HTMLInputElement,
	descendants,
	readonlyCollection,
} from './dom.ts';
import { Event, SubmitEvent, FormDataEvent, type EventTarget } from './events.ts';
import { isFocusable } from './focus.ts';
import {
	formOwner,
	formControls,
	controlState,
	registerControl,
	isDisabled,
	labelControl,
	labelsFor,
	validityFor,
	validationMessageFor,
	setControlValidity,
	validateControl,
	type ValidityState,
} from './forms.ts';

export interface FormElement extends Element {
	name: string;
	method: string;
	noValidate: boolean;
	readonly elements: readonly Element[];
	readonly length: number;
	reset(): void;
	checkValidity(): boolean;
	reportValidity(): boolean;
	requestSubmit(submitter?: Element | null): void;
	submit(): void;
}
export interface ButtonElement extends Element {
	name: string;
	value: string;
	type: string;
	disabled: boolean;
	formNoValidate: boolean;
	formMethod: string;
	readonly form: HTMLFormElement | null;
	readonly labels: readonly Element[];
	readonly willValidate: boolean;
	readonly validity: ValidityState;
	readonly validationMessage: string;
	setCustomValidity(message: string): void;
	checkValidity(): boolean;
	reportValidity(): boolean;
}
export interface LabelElement extends Element {
	htmlFor: string;
	readonly control: Element | null;
	readonly form: HTMLFormElement | null;
}
export interface FieldSetElement extends Element {
	name: string;
	disabled: boolean;
	readonly form: HTMLFormElement | null;
	readonly type: 'fieldset';
	readonly elements: readonly Element[];
	readonly willValidate: false;
	readonly validity: ValidityState;
	readonly validationMessage: string;
	setCustomValidity(message: string): void;
	checkValidity(): boolean;
	reportValidity(): boolean;
}
export interface LegendElement extends Element {
	readonly form: HTMLFormElement | null;
}
export interface FormElementConstructor<T> {
	new (document: Document): T;
}
interface FormElementClasses {
	HTMLFormElement: FormElementConstructor<FormElement>;
	HTMLButtonElement: FormElementConstructor<ButtonElement>;
	HTMLLabelElement: FormElementConstructor<LabelElement>;
	HTMLFieldSetElement: FormElementConstructor<FieldSetElement>;
	HTMLLegendElement: FormElementConstructor<LegendElement>;
}

/** Form entry collection uses the platform's actual FormData/Blob implementation. */
const constructingEntryList = new WeakSet<Element>();
export class FormData extends globalThis.FormData {
	constructor(form?: HTMLFormElement, submitter?: Element | null) {
		super();
		if (form === undefined) return;
		// oxlint-disable-next-line bombshell-dev/no-generic-error -- Web IDL rejects non-form arguments.
		if (!(form instanceof FormClass)) throw new TypeError('Expected an HTMLFormElement');
		validateSubmitter(form, submitter ?? null);
		if (constructingEntryList.has(form))
			throw new DOMException(
				'The form entry list is already being constructed',
				'InvalidStateError',
			);
		constructingEntryList.add(form);
		try {
			const data = new FormData();
			for (const control of formControls(form)) {
				if (isDisabled(control) || insideDataList(control)) continue;
				for (const [name, value] of controlState(control)?.entries(submitter ?? null) ?? [])
					data.append(name, value);
			}
			form.dispatchEvent(new FormDataEvent('formdata', { bubbles: true, formData: data }));
			// The constructor receives a clone after synchronous formdata customization.
			for (const [name, value] of data) this.append(name, value);
		} finally {
			constructingEntryList.delete(form);
		}
	}
}
function insideDataList(element: Element): boolean {
	for (let node = element.parentElement; node; node = node.parentElement)
		if (node.namespaceURI === HTML_NAMESPACE && node.localName === 'datalist') return true;
	return false;
}
function isSubmitButton(element: Element): boolean {
	return element instanceof ButtonClass
		? element.type === 'submit'
		: element instanceof HTMLInputElement && ['submit', 'image'].includes(element.type);
}
function validateSubmitter(form: Element, submitter: Element | null): void {
	if (!submitter) return;
	// oxlint-disable-next-line bombshell-dev/no-generic-error -- requestSubmit uses a Web IDL TypeError for non-submit buttons.
	if (!isSubmitButton(submitter)) throw new TypeError('The submitter must be a submit button');
	if (formOwner(submitter) !== form)
		throw new DOMException('Submitter belongs to another form', 'NotFoundError');
}
function method(element: Element, name: string): string {
	const value = element.getAttribute(name)?.toLowerCase();
	return value === 'post' || value === 'dialog' ? value : 'get';
}
function interactiveDescendant(element: Element): boolean {
	if (element.namespaceURI !== HTML_NAMESPACE) return false;
	if (
		['button', 'details', 'embed', 'iframe', 'label', 'select', 'textarea'].includes(
			element.localName,
		)
	)
		return true;
	if (element.localName === 'a') return element.hasAttribute('href');
	if (element.localName === 'input')
		return element.getAttribute('type')?.toLowerCase() !== 'hidden';
	if (element.localName === 'audio' || element.localName === 'video')
		return element.hasAttribute('controls');
	return element.localName === 'img' && element.hasAttribute('usemap');
}

/** Evaluated after the common Element base has been defined. */
export function defineFormElements(Base: typeof Element): FormElementClasses {
	class HTMLFormElement extends Base implements FormElement {
		#resetting = false;
		#firingSubmissionEvents = false;
		readonly #elements = readonlyCollection(() => formControls(this));
		constructor(document: Document) {
			super('form', document);
		}
		get name(): string {
			return this.getAttribute('name') ?? '';
		}
		set name(value: string) {
			this.setAttribute('name', value);
		}
		get method(): string {
			return method(this, 'method');
		}
		set method(value: string) {
			this.setAttribute('method', value);
		}
		get noValidate(): boolean {
			return this.hasAttribute('novalidate');
		}
		set noValidate(value: boolean) {
			this.toggleAttribute('novalidate', Boolean(value));
		}
		get elements(): readonly Element[] {
			return this.#elements;
		}
		get length(): number {
			return this.elements.length;
		}
		reset(): void {
			if (this.#resetting) return;
			this.#resetting = true;
			try {
				if (!this.dispatchEvent(new Event('reset', { bubbles: true, cancelable: true }))) return;
				for (const element of formControls(this)) controlState(element)?.reset();
			} finally {
				this.#resetting = false;
			}
		}
		checkValidity(): boolean {
			let valid = true;
			for (const element of formControls(this)) if (!validateControl(element)) valid = false;
			return valid;
		}
		reportValidity(): boolean {
			let valid = true;
			const unhandled: Element[] = [];
			for (const element of formControls(this)) {
				if (!controlState(element)?.willValidate() || validityFor(element).valid) continue;
				valid = false;
				if (element.dispatchEvent(new Event('invalid', { cancelable: true })))
					unhandled.push(element);
			}
			unhandled.find(isFocusable)?.focus();
			return valid;
		}
		requestSubmit(submitter: Element | null = null): void {
			validateSubmitter(this, submitter);
			this.#submit(submitter, false);
		}
		submit(): void {
			this.#submit(null, true);
		}
		#submit(submitter: Element | null, bypass: boolean): void {
			if (constructingEntryList.has(this) || !this.isConnected) return;
			if (!bypass) {
				if (this.#firingSubmissionEvents) return;
				this.#firingSubmissionEvents = true;
				try {
					if (
						!this.noValidate &&
						!submitter?.hasAttribute('formnovalidate') &&
						!this.reportValidity()
					)
						return;
					if (
						!this.dispatchEvent(
							new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter }),
						)
					)
						return;
				} finally {
					this.#firingSubmissionEvents = false;
				}
			}
			if (!this.isConnected) return;
			// Entry construction and formdata happen before method=dialog handling too.
			// oxlint-disable-next-line no-new -- Construction delivers the standard formdata event to the host.
			new FormData(this, submitter);
			if (!this.isConnected) return;
			const submissionMethod = submitter?.hasAttribute('formmethod')
				? method(submitter, 'formmethod')
				: this.method;
			if (submissionMethod === 'dialog') {
				for (let parent = this.parentElement; parent; parent = parent.parentElement) {
					if (
						parent.namespaceURI === HTML_NAMESPACE &&
						parent.localName === 'dialog' &&
						'close' in parent &&
						typeof parent.close === 'function'
					) {
						parent.close(submitter && 'value' in submitter ? String(submitter.value) : undefined);
						return;
					}
				}
				return;
			}
			// The formdata event hands the entry list to the host. There is no network/navigation step.
		}
	}
	class HTMLButtonElement extends Base implements ButtonElement {
		constructor(document: Document) {
			super('button', document);
			registerControl(this, {
				reset: () => {},
				entries: (submitter) => (submitter === this && this.name ? [[this.name, this.value]] : []),
				validity: () => ({}),
				willValidate: () => this.type === 'submit' && !isDisabled(this) && !insideDataList(this),
			});
		}
		get name(): string {
			return this.getAttribute('name') ?? '';
		}
		set name(value: string) {
			this.setAttribute('name', value);
		}
		get value(): string {
			return this.getAttribute('value') ?? '';
		}
		set value(value: string) {
			this.setAttribute('value', value);
		}
		get type(): string {
			const value = this.getAttribute('type')?.toLowerCase();
			return value === 'button' || value === 'reset' ? value : 'submit';
		}
		set type(value: string) {
			this.setAttribute('type', value);
		}
		get disabled(): boolean {
			return this.hasAttribute('disabled');
		}
		set disabled(value: boolean) {
			this.toggleAttribute('disabled', Boolean(value));
		}
		get formNoValidate(): boolean {
			return this.hasAttribute('formnovalidate');
		}
		set formNoValidate(value: boolean) {
			this.toggleAttribute('formnovalidate', Boolean(value));
		}
		get formMethod(): string {
			return method(this, 'formmethod');
		}
		set formMethod(value: string) {
			this.setAttribute('formmethod', value);
		}
		get form(): FormElement | null {
			return formOwner(this);
		}
		get labels(): readonly Element[] {
			return labelsFor(this);
		}
		get willValidate(): boolean {
			return controlState(this)?.willValidate() ?? false;
		}
		get validity(): ValidityState {
			return validityFor(this);
		}
		get validationMessage(): string {
			return validationMessageFor(this);
		}
		setCustomValidity(message: string): void {
			setControlValidity(this, message);
		}
		checkValidity(): boolean {
			return validateControl(this);
		}
		reportValidity(): boolean {
			return validateControl(this, true);
		}
		protected override activationDisabled(): boolean {
			return isDisabled(this);
		}
		protected override activationBehavior(_event: Event): void {
			if (isDisabled(this)) return;
			if (this.type === 'submit') this.form?.requestSubmit(this);
			else if (this.type === 'reset') this.form?.reset();
		}
	}
	class HTMLLabelElement extends Base implements LabelElement {
		constructor(document: Document) {
			super('label', document);
		}
		get htmlFor(): string {
			return this.getAttribute('for') ?? '';
		}
		set htmlFor(value: string) {
			this.setAttribute('for', value);
		}
		get control(): Element | null {
			return labelControl(this);
		}
		get form(): FormElement | null {
			return this.control ? formOwner(this.control) : null;
		}
		protected override activationBehavior(_event: Event, target: EventTarget | null): void {
			const control = this.control;
			if (!control || isDisabled(control)) return;
			for (
				let node =
					target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
				node && node !== this;
				node = node.parentElement
			)
				if (node === control || interactiveDescendant(node)) return;
			control.focus();
			control.click();
		}
	}
	class HTMLFieldSetElement extends Base implements FieldSetElement {
		readonly #elements = readonlyCollection(() =>
			descendants(this).filter((element) => controlState(element) !== undefined),
		);
		constructor(document: Document) {
			super('fieldset', document);
			registerControl(this, {
				reset: () => {},
				entries: () => [],
				validity: () => ({}),
				willValidate: () => false,
			});
		}
		get name(): string {
			return this.getAttribute('name') ?? '';
		}
		set name(value: string) {
			this.setAttribute('name', value);
		}
		get disabled(): boolean {
			return this.hasAttribute('disabled');
		}
		set disabled(value: boolean) {
			this.toggleAttribute('disabled', Boolean(value));
		}
		get form(): FormElement | null {
			return formOwner(this);
		}
		get type(): 'fieldset' {
			return 'fieldset';
		}
		get elements(): readonly Element[] {
			return this.#elements;
		}
		get willValidate(): false {
			return false;
		}
		get validity(): ValidityState {
			return validityFor(this);
		}
		get validationMessage(): string {
			return '';
		}
		setCustomValidity(message: string): void {
			setControlValidity(this, message);
		}
		checkValidity(): boolean {
			return true;
		}
		reportValidity(): boolean {
			return true;
		}
	}
	class HTMLLegendElement extends Base implements LegendElement {
		constructor(document: Document) {
			super('legend', document);
		}
		get form(): FormElement | null {
			return this.parentElement?.namespaceURI === HTML_NAMESPACE &&
				this.parentElement.localName === 'fieldset'
				? formOwner(this.parentElement)
				: null;
		}
	}
	return {
		HTMLFormElement,
		HTMLButtonElement,
		HTMLLabelElement,
		HTMLFieldSetElement,
		HTMLLegendElement,
	};
}

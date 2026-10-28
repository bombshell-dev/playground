/* oxlint-disable bombshell-dev/exported-function-async -- Synchronous HTML element algorithms. */
import {
	Element,
	Text,
	descendants,
	readonlyCollection,
	type Document,
	type HTMLFormElement,
	type Node,
} from './dom.ts';
import { Event } from './events.ts';
import { subscribeMutations } from './hooks.ts';
import { DOMTokenList } from './tokens.ts';
import {
	formOwner,
	isDisabled,
	labelsFor,
	registerControl,
	setControlValidity,
	validateControl,
	validationMessageFor,
	validityFor,
	type ValidityState,
} from './forms.ts';

interface FormValueElement extends Element {
	name: string;
	readonly form: HTMLFormElement | null;
	readonly labels: readonly Element[];
	readonly willValidate: boolean;
	readonly validity: ValidityState;
	readonly validationMessage: string;
	checkValidity(): boolean;
	reportValidity(): boolean;
	setCustomValidity(message: string): void;
}

export interface SelectElement extends FormValueElement {
	disabled: boolean;
	multiple: boolean;
	required: boolean;
	size: number;
	readonly type: 'select-one' | 'select-multiple';
	readonly options: readonly OptionElement[];
	readonly selectedOptions: readonly OptionElement[];
	length: number;
	selectedIndex: number;
	value: string;
	item(index: number): OptionElement | null;
	namedItem(name: string): OptionElement | null;
	add(element: OptionElement | OptGroupElement, before?: Element | number | null): void;
	remove(index?: number): void;
}
export interface OptionElement extends Element {
	disabled: boolean;
	defaultSelected: boolean;
	selected: boolean;
	value: string;
	label: string;
	text: string;
	readonly index: number;
	readonly form: HTMLFormElement | null;
}
export interface OptGroupElement extends Element {
	disabled: boolean;
	label: string;
}
export interface DataListElement extends Element {
	readonly options: readonly OptionElement[];
}
export interface OutputElement extends FormValueElement {
	readonly type: 'output';
	get htmlFor(): DOMTokenList;
	set htmlFor(value: string);
	value: string;
	defaultValue: string;
}
export interface ProgressElement extends Element {
	value: number;
	max: number;
	readonly position: number;
	readonly labels: readonly Element[];
}
export interface MeterElement extends Element {
	value: number;
	min: number;
	max: number;
	low: number;
	high: number;
	optimum: number;
	readonly labels: readonly Element[];
}
interface ValueElementConstructors {
	HTMLSelectElement: new (document: Document) => SelectElement;
	HTMLOptionElement: new (document: Document) => OptionElement;
	HTMLOptGroupElement: new (document: Document) => OptGroupElement;
	HTMLDataListElement: new (document: Document) => DataListElement;
	HTMLSelectedContentElement: new (document: Document) => Element;
	HTMLOutputElement: new (document: Document) => OutputElement;
	HTMLProgressElement: new (document: Document) => ProgressElement;
	HTMLMeterElement: new (document: Document) => MeterElement;
}
interface OptionState {
	selected: boolean;
	dirty: boolean;
}
const optionStates = new WeakMap<Element, OptionState>();
const selectStates = new WeakMap<Element, SelectElement>();
const updatingContent = new WeakSet<Element>();
const queuedContentUpdates = new WeakSet<Element>();

/** @internal Define subclasses after the common Element base has initialized. */
export function defineValueElements(ElementBase: typeof Element): ValueElementConstructors {
	class HTMLSelectElement extends ElementBase implements SelectElement {
		readonly #options = readonlyCollection(() => optionsOf(this));
		readonly #selectedOptions = readonlyCollection(() =>
			optionsOf(this).filter((option) => option.selected),
		);
		constructor(document: Document) {
			super('select', document);
			selectStates.set(this, this);
			registerControl(this, {
				reset: () => {
					for (const option of optionsOf(this)) {
						const state = optionState(option);
						state.dirty = false;
						state.selected = option.defaultSelected;
					}
					normalizeSelection(this);
					updateSelectedContent(this);
					invalidate(this);
				},
				entries: () =>
					this.name && !isDisabled(this)
						? optionsOf(this)
								.filter((option) => option.selected && !optionDisabled(option))
								.map((option) => [this.name, option.value] as const)
						: [],
				validity: () => {
					const options = optionsOf(this);
					const selected = options.filter((option) => option.selected);
					const placeholder =
						!this.multiple &&
						displaySize(this) === 1 &&
						options[0]?.parentNode === this &&
						options[0].value === ''
							? options[0]
							: null;
					return {
						valueMissing:
							this.required &&
							(selected.length === 0 || (selected.length === 1 && selected[0] === placeholder)),
					};
				},
				willValidate: () => !isDisabled(this) && !hasAncestor(this, 'datalist'),
				value: () => this.value,
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
		get multiple(): boolean {
			return this.hasAttribute('multiple');
		}
		set multiple(value: boolean) {
			this.toggleAttribute('multiple', Boolean(value));
		}
		get required(): boolean {
			return this.hasAttribute('required');
		}
		set required(value: boolean) {
			this.toggleAttribute('required', Boolean(value));
		}
		get size(): number {
			const match = /^[\t\n\f\r ]*\+?(\d+)/.exec(this.getAttribute('size') ?? '');
			const size = match ? Number(match[1]) : 0;
			return size <= 2147483647 ? size : 0;
		}
		set size(value: number) {
			this.setAttribute('size', String(Number(value) >>> 0));
		}
		get type(): 'select-one' | 'select-multiple' {
			return this.multiple ? 'select-multiple' : 'select-one';
		}
		get form(): HTMLFormElement | null {
			return formOwner(this);
		}
		get labels(): readonly Element[] {
			return labelsFor(this);
		}
		get willValidate(): boolean {
			return !isDisabled(this) && !hasAncestor(this, 'datalist');
		}
		get validity(): ValidityState {
			return validityFor(this);
		}
		get validationMessage(): string {
			return validationMessageFor(this);
		}
		checkValidity(): boolean {
			return validateControl(this);
		}
		reportValidity(): boolean {
			return validateControl(this, true);
		}
		setCustomValidity(message: string): void {
			setControlValidity(this, message);
		}
		get options(): readonly OptionElement[] {
			return this.#options;
		}
		get selectedOptions(): readonly OptionElement[] {
			return this.#selectedOptions;
		}
		get length(): number {
			return this.options.length;
		}
		set length(value: number) {
			const length = Number(value) >>> 0;
			while (this.length > length) this.options.at(-1)?.remove();
			while (this.length < length) this.appendChild(new HTMLOptionElement(this.ownerDocument));
		}
		get selectedIndex(): number {
			return optionsOf(this).findIndex((option) => option.selected);
		}
		set selectedIndex(value: number) {
			const index = Number(value) | 0;
			for (const [current, option] of optionsOf(this).entries()) {
				const state = optionState(option);
				state.selected = current === index;
				if (state.selected) state.dirty = true;
			}
			updateSelectedContent(this);
			invalidate(this);
		}
		get value(): string {
			return this.options.find((option) => option.selected)?.value ?? '';
		}
		set value(value: string) {
			const text = String(value);
			this.selectedIndex = optionsOf(this).findIndex((option) => option.value === text);
		}
		item(index: number): OptionElement | null {
			return this.options[Number(index) >>> 0] ?? null;
		}
		namedItem(name: string): OptionElement | null {
			const key = String(name);
			return key
				? (this.options.find(
						(option) => option.id === key || option.getAttribute('name') === key,
					) ?? null)
				: null;
		}
		add(element: OptionElement | OptGroupElement, before: Element | number | null = null): void {
			if (!(element instanceof HTMLOptionElement || element instanceof HTMLOptGroupElement)) {
				// oxlint-disable-next-line bombshell-dev/no-generic-error -- Web IDL interface conversion.
				throw new TypeError('Expected an option or optgroup');
			}
			const anchor =
				typeof before === 'number' ? (this.options[Number(before) | 0] ?? null) : before;
			if (anchor && (anchor === this || !this.contains(anchor)))
				throw new DOMException('The anchor is not in this select', 'NotFoundError');
			(anchor?.parentNode ?? this).insertBefore(element, anchor);
		}
		override remove(index?: number): void {
			if (arguments.length === 0) super.remove();
			else this.options[Number(index) | 0]?.remove();
		}
	}
	class HTMLOptionElement extends ElementBase implements OptionElement {
		constructor(document: Document) {
			super('option', document);
			optionStates.set(this, { selected: false, dirty: false });
		}
		get disabled(): boolean {
			return this.hasAttribute('disabled');
		}
		set disabled(value: boolean) {
			this.toggleAttribute('disabled', Boolean(value));
		}
		get defaultSelected(): boolean {
			return this.hasAttribute('selected');
		}
		set defaultSelected(value: boolean) {
			this.toggleAttribute('selected', Boolean(value));
		}
		get selected(): boolean {
			return optionState(this).selected;
		}
		set selected(value: boolean) {
			const state = optionState(this);
			state.dirty = true;
			state.selected = Boolean(value);
			const select = ownerSelect(this);
			if (select) {
				if (state.selected) deselectOthers(select, this);
				normalizeSelection(select);
				updateSelectedContent(select);
			}
			invalidate(this);
		}
		get value(): string {
			return this.getAttribute('value') ?? optionText(this);
		}
		set value(value: string) {
			this.setAttribute('value', value);
		}
		get label(): string {
			return this.getAttribute('label') ?? optionText(this);
		}
		set label(value: string) {
			this.setAttribute('label', value);
		}
		get text(): string {
			return optionText(this);
		}
		set text(value: string) {
			this.textContent = String(value);
		}
		get index(): number {
			return ownerSelect(this)?.options.indexOf(this) ?? 0;
		}
		get form(): HTMLFormElement | null {
			const select = ownerSelect(this);
			return select ? formOwner(select) : null;
		}
	}
	class HTMLOptGroupElement extends ElementBase implements OptGroupElement {
		constructor(document: Document) {
			super('optgroup', document);
		}
		get disabled(): boolean {
			return this.hasAttribute('disabled');
		}
		set disabled(value: boolean) {
			this.toggleAttribute('disabled', Boolean(value));
		}
		get label(): string {
			return this.getAttribute('label') ?? '';
		}
		set label(value: string) {
			this.setAttribute('label', value);
		}
	}
	class HTMLDataListElement extends ElementBase implements DataListElement {
		readonly #options = readonlyCollection(() =>
			descendants(this).filter((element): element is OptionElement => optionStates.has(element)),
		);
		constructor(document: Document) {
			super('datalist', document);
		}
		get options(): readonly OptionElement[] {
			return this.#options;
		}
	}
	class HTMLSelectedContentElement extends ElementBase {
		constructor(document: Document) {
			super('selectedcontent', document);
		}
	}
	class HTMLOutputElement extends ElementBase implements OutputElement {
		#defaultValue: string | null = null;
		readonly #htmlFor = new DOMTokenList(this, 'for');
		constructor(document: Document) {
			super('output', document);
			registerControl(this, {
				reset: () => {
					this.textContent = this.defaultValue;
					this.#defaultValue = null;
				},
				entries: () => [],
				validity: () => ({}),
				willValidate: () => false,
				value: () => this.value,
			});
		}
		get name(): string {
			return this.getAttribute('name') ?? '';
		}
		set name(value: string) {
			this.setAttribute('name', value);
		}
		get type(): 'output' {
			return 'output';
		}
		get htmlFor(): DOMTokenList {
			return this.#htmlFor;
		}
		set htmlFor(value: string) {
			this.#htmlFor.value = value;
		}
		get value(): string {
			return this.textContent ?? '';
		}
		set value(value: string) {
			this.#defaultValue = this.defaultValue;
			this.textContent = String(value);
		}
		get defaultValue(): string {
			return this.#defaultValue ?? this.textContent ?? '';
		}
		set defaultValue(value: string) {
			if (this.#defaultValue === null) this.textContent = String(value);
			else this.#defaultValue = String(value);
		}
		get form(): HTMLFormElement | null {
			return formOwner(this);
		}
		get labels(): readonly Element[] {
			return labelsFor(this);
		}
		get willValidate(): boolean {
			return false;
		}
		get validity(): ValidityState {
			return validityFor(this);
		}
		get validationMessage(): string {
			return validationMessageFor(this);
		}
		checkValidity(): boolean {
			return validateControl(this);
		}
		reportValidity(): boolean {
			return validateControl(this, true);
		}
		setCustomValidity(message: string): void {
			setControlValidity(this, message);
		}
	}
	class HTMLProgressElement extends ElementBase implements ProgressElement {
		constructor(document: Document) {
			super('progress', document);
		}
		get value(): number {
			return clamp(numberAttribute(this, 'value', 0), 0, this.max);
		}
		set value(value: number) {
			setNumber(this, 'value', value);
		}
		get max(): number {
			const value = numberAttribute(this, 'max', 1);
			return value > 0 ? value : 1;
		}
		set max(value: number) {
			const number = finiteNumber(value);
			if (number > 0) this.setAttribute('max', String(number));
		}
		get position(): number {
			return this.hasAttribute('value') ? this.value / this.max : -1;
		}
		get labels(): readonly Element[] {
			return labelsFor(this);
		}
	}
	class HTMLMeterElement extends ElementBase implements MeterElement {
		constructor(document: Document) {
			super('meter', document);
		}
		get value(): number {
			return clamp(numberAttribute(this, 'value', 0), this.min, this.max);
		}
		set value(value: number) {
			setNumber(this, 'value', value);
		}
		get min(): number {
			return numberAttribute(this, 'min', 0);
		}
		set min(value: number) {
			setNumber(this, 'min', value);
		}
		get max(): number {
			return Math.max(this.min, numberAttribute(this, 'max', 1));
		}
		set max(value: number) {
			setNumber(this, 'max', value);
		}
		get low(): number {
			return clamp(numberAttribute(this, 'low', this.min), this.min, this.max);
		}
		set low(value: number) {
			setNumber(this, 'low', value);
		}
		get high(): number {
			return clamp(numberAttribute(this, 'high', this.max), this.low, this.max);
		}
		set high(value: number) {
			setNumber(this, 'high', value);
		}
		get optimum(): number {
			return clamp(numberAttribute(this, 'optimum', (this.min + this.max) / 2), this.min, this.max);
		}
		set optimum(value: number) {
			setNumber(this, 'optimum', value);
		}
		get labels(): readonly Element[] {
			return labelsFor(this);
		}
	}
	return {
		HTMLSelectElement,
		HTMLOptionElement,
		HTMLOptGroupElement,
		HTMLDataListElement,
		HTMLSelectedContentElement,
		HTMLOutputElement,
		HTMLProgressElement,
		HTMLMeterElement,
	};
}

function optionState(option: Element): OptionState {
	const state = optionStates.get(option);
	// oxlint-disable-next-line bombshell-dev/no-generic-error -- Internal brand check.
	if (!state) throw new TypeError('Expected an option');
	return state;
}
function optionsOf(select: Element): OptionElement[] {
	const result: OptionElement[] = [];
	const visit = (parent: Element, inGroup: boolean): void => {
		for (const child of parent.children) {
			if (optionStates.has(child)) {
				result.push(child as OptionElement);
				continue;
			}
			if (['select', 'hr', 'datalist'].includes(child.localName)) continue;
			if (child.localName === 'optgroup' && inGroup) continue;
			visit(child, inGroup || child.localName === 'optgroup');
		}
	};
	visit(select, false);
	return result;
}
function ownerSelect(option: Element): SelectElement | null {
	for (let ancestor = option.parentElement; ancestor; ancestor = ancestor.parentElement) {
		const select = selectStates.get(ancestor);
		if (select) return optionsOf(select).includes(option as OptionElement) ? select : null;
	}
	return null;
}
function hasAncestor(element: Element, name: string): boolean {
	for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement)
		if (ancestor.localName === name) return true;
	return false;
}
function optionDisabled(option: OptionElement): boolean {
	if (option.disabled) return true;
	for (let ancestor = option.parentElement; ancestor; ancestor = ancestor.parentElement) {
		if (['select', 'hr', 'datalist', 'option'].includes(ancestor.localName)) return false;
		if (ancestor.localName === 'optgroup') return ancestor.hasAttribute('disabled');
	}
	return false;
}
function optionText(option: Element): string {
	const visit = (parent: Node): string =>
		parent.childNodes
			.map((node) => {
				if (node instanceof Text) return node.data;
				if (!(node instanceof Element) || node.localName === 'script') return '';
				if (node.localName === 'img') return '';
				return visit(node);
			})
			.join('');
	return visit(option)
		.replace(/[\t\n\f\r ]+/g, ' ')
		.replace(/^ | $/g, '');
}
function displaySize(select: SelectElement): number {
	return select.size || (select.multiple ? 4 : 1);
}
function deselectOthers(select: SelectElement, selected: OptionElement): void {
	if (!select.multiple)
		for (const option of optionsOf(select))
			if (option !== selected) optionState(option).selected = false;
}
function normalizeSelection(select: SelectElement): boolean {
	if (select.multiple) return false;
	const options = optionsOf(select);
	const selectedOptions = options.filter((option) => option.selected);
	const selected = selectedOptions.at(-1);
	if (selected) {
		deselectOthers(select, selected);
		return selectedOptions.length > 1;
	} else if (displaySize(select) === 1) {
		const first = options.find((option) => !optionDisabled(option));
		if (first) {
			optionState(first).selected = true;
			return true;
		}
	}
	return false;
}
function invalidate(element: Element): void {
	if (element.isConnected) element.ownerDocument.invalidate({ kind: 'mutation', target: element });
}
function updateSelectedContent(select: SelectElement, only?: Element): void {
	if (select.multiple || updatingContent.has(select)) return;
	updatingContent.add(select);
	try {
		const option = optionsOf(select).find((item) => item.selected);
		for (const element of only ? [only] : descendants(select)) {
			if (element.localName !== 'selectedcontent') continue;
			let disabled = false;
			let selectCount = 0;
			for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
				if (ancestor.localName === 'select') selectCount++;
				if (['option', 'selectedcontent'].includes(ancestor.localName) || selectCount > 1) {
					disabled = true;
					break;
				}
			}
			if (!disabled)
				element.replaceChildren(
					...(option?.childNodes.map((child) => child.cloneNode(true)) ?? []),
				);
		}
	} finally {
		updatingContent.delete(select);
	}
}
function queueSelectedContentUpdate(select: SelectElement): void {
	if (queuedContentUpdates.has(select)) return;
	queuedContentUpdates.add(select);
	queueMicrotask(() => {
		queuedContentUpdates.delete(select);
		updateSelectedContent(select);
	});
}

/** @internal Host selection acts on option indices, retaining duplicate-value distinctions. */
export function changeSelectSelection(element: Element, indices: readonly number[]): boolean {
	const select = selectStates.get(element);
	if (!select || isDisabled(select)) return false;
	const options = optionsOf(select);
	const requested = new Set(
		indices
			.map((index) => Number(index) | 0)
			.filter((index) => options[index] && !optionDisabled(options[index])),
	);
	if (indices.length && requested.size === 0) return false;
	const first = requested.values().next().value;
	let changed = false;
	for (const [index, option] of options.entries()) {
		const state = optionState(option);
		const selected = select.multiple
			? optionDisabled(option)
				? state.selected
				: requested.has(index)
			: index === first;
		if (selected !== state.selected) {
			state.selected = selected;
			state.dirty = true;
			changed = true;
		}
	}
	if (changed) {
		updateSelectedContent(select);
		invalidate(select);
		select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
		select.dispatchEvent(new Event('change', { bubbles: true }));
	}
	return changed;
}

/** @internal Logical single-select navigation for the explicit input driver. */
export function handleSelectKey(element: Element, key: string): boolean {
	const select = selectStates.get(element);
	if (!select || select.multiple || isDisabled(select)) return false;
	const options = optionsOf(select);
	const enabled = options
		.map((option, index) => ({ option, index }))
		.filter(({ option }) => !optionDisabled(option));
	let target: number | undefined;
	if (key === 'Home') target = enabled[0]?.index;
	else if (key === 'End') target = enabled.at(-1)?.index;
	else if (key === 'ArrowDown')
		target = enabled.find(({ index }) => index > select.selectedIndex)?.index;
	else if (key === 'ArrowUp')
		target = enabled.findLast(({ index }) => index < select.selectedIndex)?.index;
	return target === undefined ? false : changeSelectSelection(select, [target]);
}

/** @internal HTML option cloning copies selectedness and dirtiness. */
export function cloneValueElementState(source: Element, copy: Element): void {
	const original = optionStates.get(source);
	const target = optionStates.get(copy);
	if (original && target) {
		target.selected = original.selected;
		target.dirty = original.dirty;
	}
	const sourceSelect = selectStates.get(source);
	const copySelect = selectStates.get(copy);
	if (sourceSelect && copySelect) {
		const originals = optionsOf(sourceSelect);
		for (const [index, option] of optionsOf(copySelect).entries()) {
			const sourceOption = originals[index];
			if (sourceOption) Object.assign(optionState(option), optionState(sourceOption));
		}
		updateSelectedContent(copySelect);
	}
}

subscribeMutations((mutation) => {
	const target = mutation.target;
	if (mutation.type === 'characterData') return;
	if (target instanceof Element && updatingContent.has(target)) return;
	const selects = new Set<SelectElement>();
	const update = new Set<SelectElement>();
	const insertedContent: Element[] = [];
	let removal = false;
	for (let node: Node | null = target; node; node = node.parentNode) {
		if (!(node instanceof Element)) continue;
		const select = selectStates.get(node);
		if (select) {
			selects.add(select);
			break;
		}
		if (node.localName === 'selectedcontent') return;
	}
	if (target instanceof Element && mutation.type === 'attributes') {
		const state = optionStates.get(target);
		if (
			mutation.attributeName === 'selected' &&
			mutation.oldValue !== null &&
			target.hasAttribute('selected')
		)
			return;
		if (state && mutation.attributeName === 'selected' && !state.dirty) {
			const changed = state.selected !== target.hasAttribute('selected');
			state.selected = target.hasAttribute('selected');
			const select = ownerSelect(target);
			if (select && state.selected) deselectOthers(select, target as OptionElement);
			if (select && changed) update.add(select);
		}
		if (!['selected', 'disabled', 'multiple', 'size'].includes(mutation.attributeName ?? ''))
			return;
	}
	if (mutation.type === 'childList') {
		// Option content is snapshotted when selection changes, not live mirrored.
		for (let node: Node | null = target; node; node = node.parentNode) {
			if (node instanceof Element && optionStates.has(node)) return;
		}
		const changedElements = [
			...(mutation.addedNodes ?? []),
			...(mutation.removedNodes ?? []),
		].flatMap((node) =>
			node instanceof Element ? [node, ...descendants(node)] : descendants(node),
		);
		if (
			!changedElements.some(
				(element) =>
					optionStates.has(element) ||
					selectStates.has(element) ||
					element.localName === 'selectedcontent',
			)
		)
			return;
		for (const removed of mutation.removedNodes ?? []) {
			const elements =
				removed instanceof Element ? [removed, ...descendants(removed)] : descendants(removed);
			if (elements.some((element) => optionStates.get(element)?.selected)) {
				removal = true;
				for (const select of selects) update.add(select);
			}
		}
		for (const added of mutation.addedNodes ?? []) {
			const elements =
				added instanceof Element ? [added, ...descendants(added)] : descendants(added);
			for (const element of elements) {
				const select = selectStates.get(element);
				if (select) {
					selects.add(select);
					update.add(select);
				}
				if (element.localName === 'selectedcontent') insertedContent.push(element);
				if (optionStates.get(element)?.selected) {
					const owner = ownerSelect(element);
					if (owner) {
						deselectOthers(owner, element as OptionElement);
						selects.add(owner);
						update.add(owner);
					}
				}
			}
		}
	}
	for (const select of selects) {
		if (normalizeSelection(select)) update.add(select);
		if (update.has(select)) {
			if (removal) queueSelectedContentUpdate(select);
			else updateSelectedContent(select);
		} else {
			for (const content of insertedContent)
				if (select.contains(content)) updateSelectedContent(select, content);
		}
	}
});

// oxlint-disable-next-line bombshell-dev/max-params -- Internal numeric reflection algorithm.
function numberAttribute(element: Element, name: string, fallback: number): number {
	const value = Number.parseFloat(element.getAttribute(name) ?? '');
	return Number.isFinite(value) ? value : fallback;
}
// oxlint-disable-next-line bombshell-dev/max-params -- Internal numeric reflection algorithm.
function setNumber(element: Element, name: string, value: number): void {
	element.setAttribute(name, String(finiteNumber(value)));
}
function finiteNumber(value: number): number {
	const number = Number(value);
	if (!Number.isFinite(number)) {
		// oxlint-disable-next-line bombshell-dev/no-generic-error -- Web IDL double rejects non-finite values.
		throw new TypeError('Expected a finite number');
	}
	return number;
}
// oxlint-disable-next-line bombshell-dev/max-params -- Conventional inclusive numeric range operation.
function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), maximum);
}

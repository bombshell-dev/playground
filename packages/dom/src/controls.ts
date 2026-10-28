import type { Element, HTMLInputElement, Node } from './dom.ts';
import { formOwner, formTree, type ValidityFlags } from './forms.ts';
import { Event } from './events.ts';
import { subscribeMutations } from './hooks.ts';

export type SelectionDirection = 'forward' | 'backward' | 'none';
export type SelectionMode = 'select' | 'start' | 'end' | 'preserve';

export interface TextControlOptions {
	element: Element;
	multiline: boolean;
	defaultValue: () => string;
	supportsSelection?: () => boolean;
	sanitize?: (value: string) => string;
}

const controls = new WeakMap<Node, TextControlState>();

/** Shared value and UTF-16 selection algorithms for input and textarea elements. */
export class TextControlState {
	readonly #options: TextControlOptions;
	#value = '';
	#dirty = false;
	#defaultSnapshot = '';
	#start = 0;
	#end = 0;
	#direction: SelectionDirection = 'none';
	#selectionChangeQueued = false;
	#userEdited = false;

	constructor(options: TextControlOptions) {
		this.#options = options;
		controls.set(options.element, this);
	}

	get userEdited(): boolean {
		return this.#userEdited;
	}
	markUserEdited(): void {
		if (this.#userEdited) return;
		this.#userEdited = true;
		this.#invalidate('mutation');
	}
	reset(): void {
		const previous = this.value;
		const wasUserEdited = this.#userEdited;
		this.#dirty = false;
		this.#userEdited = false;
		this.defaultValueChanged();
		if (previous !== this.value || wasUserEdited) this.#invalidate('mutation');
	}
	resanitize(): void {
		const previous = this.#value;
		this.#value = this.#normalize(previous);
		if (previous !== this.#value) this.#invalidate('mutation');
	}
	get value(): string {
		const currentDefault = this.#normalize(this.#options.defaultValue());
		if (!this.#dirty && currentDefault !== this.#defaultSnapshot) this.#value = currentDefault;
		this.#defaultSnapshot = currentDefault;
		return this.#value;
	}

	/** @internal HTML cloning copies value and dirtiness, without copying selection. */
	copyValueFrom(source: TextControlState): void {
		this.#value = source.value;
		this.#dirty = source.#dirty;
		this.#userEdited = source.#userEdited;
		this.#defaultSnapshot = this.#normalize(this.#options.defaultValue());
	}

	/** @internal Attribute/children changes update only a pristine control value. */
	defaultValueChanged(): void {
		this.#defaultSnapshot = this.#normalize(this.#options.defaultValue());
		if (this.#dirty) return;
		this.#value = this.#defaultSnapshot;
		this.#setSelection({
			start: Math.min(this.#start, this.#value.length),
			end: Math.min(this.#end, this.#value.length),
			direction: this.#direction,
		});
	}

	set value(value: string) {
		const normalized = this.#normalize(value == null ? '' : String(value));
		const previous = this.value;
		const wasUserEdited = this.#userEdited;
		this.#dirty = true;
		this.#userEdited = false;
		this.#value = normalized;
		if (normalized === previous) {
			if (wasUserEdited) this.#invalidate('mutation');
			return;
		}
		if (this.#supported)
			this.#setSelection({ start: normalized.length, end: normalized.length, direction: 'none' });
		this.#invalidate('mutation');
	}

	get selectionStart(): number | null {
		return this.#supported ? Math.min(this.#start, this.value.length) : null;
	}

	set selectionStart(value: number | null) {
		this.#assertSupported();
		const start = unsigned(value);
		this.setSelectionRange(start, Math.max(start, this.selectionEnd ?? 0), this.#direction);
	}

	get selectionEnd(): number | null {
		return this.#supported ? Math.min(this.#end, this.value.length) : null;
	}

	set selectionEnd(value: number | null) {
		this.#assertSupported();
		this.setSelectionRange(this.selectionStart ?? 0, unsigned(value), this.#direction);
	}

	get selectionDirection(): SelectionDirection | null {
		return this.#supported ? this.#direction : null;
	}

	set selectionDirection(value: SelectionDirection | null) {
		this.setSelectionRange(this.selectionStart ?? 0, this.selectionEnd ?? 0, value ?? 'none');
	}

	select(): void {
		if (this.#supported) this.setSelectionRange(0, this.value.length);
	}

	// oxlint-disable-next-line bombshell-dev/max-params -- HTML text selection API.
	setSelectionRange(start: number, end: number, direction: SelectionDirection = 'none'): void {
		this.#assertSupported();
		const endOffset = Math.min(unsigned(end), this.value.length);
		const startOffset = Math.min(unsigned(start), endOffset);
		const normalizedDirection =
			direction === 'forward' || direction === 'backward' ? direction : 'none';
		this.#setSelection({ start: startOffset, end: endOffset, direction: normalizedDirection });
	}

	setRangeText(
		replacement: string,
		options: { start?: number; end?: number; selectionMode?: SelectionMode } = {},
	): void {
		this.#assertSupported();
		const mode = options.selectionMode ?? 'preserve';
		if (!['select', 'start', 'end', 'preserve'].includes(mode)) {
			// oxlint-disable-next-line bombshell-dev/no-generic-error -- Web IDL enum conversion requires TypeError.
			throw new TypeError('Invalid selection mode');
		}
		const current = this.value;
		const wasUserEdited = this.#userEdited;
		const start = unsigned(options.start === undefined ? this.selectionStart : options.start);
		const end = unsigned(options.end === undefined ? this.selectionEnd : options.end);
		if (start > end) throw new DOMException('The start is after the end', 'IndexSizeError');
		const from = Math.min(start, current.length);
		const to = Math.min(end, current.length);
		const rawReplacement = String(replacement);
		const added = this.#options.multiline
			? rawReplacement.replace(/\r\n?/g, '\n')
			: rawReplacement.replace(/[\r\n]/g, '');
		let selectedStart = this.selectionStart ?? 0;
		let selectedEnd = this.selectionEnd ?? 0;
		this.#dirty = true;
		this.#userEdited = false;
		this.#value = this.#normalize(current.slice(0, from) + added + current.slice(to));
		const insertedEnd = from + added.length;
		switch (mode) {
			case 'select':
				selectedStart = from;
				selectedEnd = insertedEnd;
				break;
			case 'start':
				selectedStart = selectedEnd = from;
				break;
			case 'end':
				selectedStart = selectedEnd = insertedEnd;
				break;
			case 'preserve': {
				const delta = added.length - (to - from);
				if (selectedStart > to) selectedStart += delta;
				else if (selectedStart > from) selectedStart = from;
				if (selectedEnd > to) selectedEnd += delta;
				else if (selectedEnd > from) selectedEnd = insertedEnd;
			}
		}
		this.#setSelection({ start: selectedStart, end: selectedEnd, direction: 'none' });
		if (this.#value !== current || wasUserEdited) this.#invalidate('mutation');
	}

	get #supported(): boolean {
		return this.#options.supportsSelection?.() ?? true;
	}

	#assertSupported(): void {
		if (!this.#supported)
			throw new DOMException(
				'This input type does not support text selection',
				'InvalidStateError',
			);
	}

	#normalize(value: string): string {
		if (this.#options.sanitize) return this.#options.sanitize(value);
		return this.#options.multiline ? value.replace(/\r\n?/g, '\n') : value.replace(/[\r\n]/g, '');
	}

	#invalidate(kind: 'mutation' | 'selection'): void {
		const element = this.#options.element;
		if (element.isConnected) element.ownerDocument.invalidate({ kind, target: element });
	}

	#setSelection(selection: { start: number; end: number; direction: SelectionDirection }): void {
		const { start, end, direction } = selection;
		if (start === this.#start && end === this.#end && direction === this.#direction) return;
		this.#start = start;
		this.#end = end;
		this.#direction = direction;
		this.#invalidate('selection');
		const element = this.#options.element;
		setTimeout(() => element.dispatchEvent(new Event('select', { bubbles: true })), 0);
		if (!this.#selectionChangeQueued) {
			this.#selectionChangeQueued = true;
			setTimeout(() => {
				this.#selectionChangeQueued = false;
				element.dispatchEvent(new Event('selectionchange', { bubbles: true }));
			}, 0);
		}
	}
}

function unsigned(value: number | null): number {
	return Number(value) >>> 0;
}

// oxlint-disable bombshell-dev/exported-function-async -- Internal synchronous DOM cloning algorithm.
/** @internal Preserve control value state during cloneNode/importNode. */
export function cloneTextControlState(source: Element, copy: Element): void {
	const original = controls.get(source);
	const target = controls.get(copy);
	if (original && target) target.copyValueFrom(original);
	inputStates.get(copy)?.copyFrom(inputStates.get(source));
}

/** @internal Run textarea's children-changed steps even for an empty default assignment. */
export function syncTextControlDefault(element: Element): void {
	controls.get(element)?.defaultValueChanged();
}

subscribeMutations((mutation) => {
	if (mutation.type === 'attributes') {
		if (mutation.attributeName === 'value') controls.get(mutation.target)?.defaultValueChanged();
		return;
	}
	for (let node: Node | null = mutation.target; node; node = node.parentNode) {
		controls.get(node)?.defaultValueChanged();
	}
});

/** @internal User editing and script assignment have different length-validity rules. */
export function markControlUserEdited(element: Element): void {
	controls.get(element)?.markUserEdited();
}

const inputStates = new WeakMap<Node, InputControlState>();
const defaultValueTypes = new Set(['hidden', 'submit', 'image', 'reset', 'button']);
const checkableTypes = new Set(['checkbox', 'radio']);
const readonlyTypes = new Set([
	'text',
	'search',
	'url',
	'tel',
	'email',
	'password',
	'date',
	'month',
	'week',
	'time',
	'datetime-local',
	'number',
]);
export function inputValueMode(type: string): 'value' | 'default' | 'default/on' | 'filename' {
	return defaultValueTypes.has(type)
		? 'default'
		: checkableTypes.has(type)
			? 'default/on'
			: type === 'file'
				? 'filename'
				: 'value';
}
export function supportsReadOnly(type: string): boolean {
	return readonlyTypes.has(type);
}

/** Input checkedness has a separate dirty flag from its value. */
export class InputControlState {
	readonly element: HTMLInputElement;
	readonly #text: TextControlState;
	#checked = false;
	#dirtyChecked = false;
	#indeterminate = false;
	#type = 'text';
	readonly #activationChanges: boolean[] = [];
	constructor(element: HTMLInputElement, text: TextControlState) {
		this.element = element;
		this.#text = text;
		inputStates.set(element, this);
	}
	get checked(): boolean {
		return this.#checked;
	}
	set checked(value: boolean) {
		this.#dirtyChecked = true;
		this.#setChecked(Boolean(value));
	}
	get indeterminate(): boolean {
		return this.#indeterminate;
	}
	set indeterminate(value: boolean) {
		if (this.#indeterminate === Boolean(value)) return;
		this.#indeterminate = Boolean(value);
		this.#invalidate();
	}
	reset(): void {
		this.#text.reset();
		this.#dirtyChecked = false;
		this.#setChecked(this.element.defaultChecked);
	}
	copyFrom(source: InputControlState | undefined): void {
		if (!source) return;
		this.#checked = source.#checked;
		this.#dirtyChecked = source.#dirtyChecked;
		this.#indeterminate = source.#indeterminate;
	}
	attributeChanged(name: string): void {
		if (name === 'checked' && !this.#dirtyChecked) this.#setChecked(this.element.defaultChecked);
		if (name === 'type') {
			const wasSelectable = ['text', 'search', 'url', 'tel', 'password'].includes(this.#type);
			const mode = inputValueMode(this.element.type);
			const oldMode = inputValueMode(this.#type);
			if (oldMode === 'value' && (mode === 'default' || mode === 'default/on') && this.#text.value)
				this.element.setAttribute('value', this.#text.value);
			else if (mode === 'value' && oldMode !== 'value') this.#text.reset();
			else if (mode === 'filename') this.#text.value = '';
			this.#type = this.element.type;
			this.#text.resanitize();
			if (!wasSelectable && ['text', 'search', 'url', 'tel', 'password'].includes(this.#type))
				this.#text.setSelectionRange(0, 0);
		}
		if (['min', 'max', 'step', 'multiple'].includes(name)) this.#text.resanitize();
		if (['type', 'name', 'form'].includes(name) && this.checked) this.enforceRadioGroup();
	}
	enforceRadioGroup(): void {
		if (!this.checked || this.element.type !== 'radio') return;
		for (const peer of radioGroup(this.element)) {
			const state = inputStates.get(peer);
			if (state && state !== this) state.#setChecked(false);
		}
	}
	completeActivation(): boolean {
		return this.#activationChanges.pop() ?? false;
	}
	preActivate(): (() => void) | null {
		this.#activationChanges.push(
			this.element.type === 'checkbox' || (this.element.type === 'radio' && !this.checked),
		);
		if (!checkableTypes.has(this.element.type))
			return () => {
				this.#activationChanges.pop();
			};
		const checked = this.#checked;
		const indeterminate = this.#indeterminate;
		const previousRadio =
			this.element.type === 'radio'
				? radioGroup(this.element).find((peer) => peer.checked)
				: undefined;
		this.checked = this.element.type === 'radio' || !this.checked;
		if (this.element.type === 'checkbox') this.indeterminate = false;
		return () => {
			this.#activationChanges.pop();
			if (this.element.type === 'checkbox') {
				this.#setChecked(checked);
				this.indeterminate = indeterminate;
			} else if (this.element.type === 'radio') {
				if (previousRadio && radioGroup(this.element).includes(previousRadio)) {
					const previousState = inputStates.get(previousRadio);
					if (previousState) previousState.#setChecked(true);
				} else this.#setChecked(false);
			}
		};
	}
	#setChecked(value: boolean): void {
		const changed = value !== this.#checked;
		this.#checked = value;
		if (value) this.enforceRadioGroup();
		if (changed) this.#invalidate();
	}
	#invalidate(): void {
		if (this.element.isConnected)
			this.element.ownerDocument.invalidate({ kind: 'mutation', target: this.element });
	}
}

export function radioGroup(element: HTMLInputElement): readonly HTMLInputElement[] {
	if (element.type !== 'radio' || !element.name) return [element];
	const owner = formOwner(element);
	return formTree(element.getRootNode()).flatMap((candidate) => {
		const peer = inputStates.get(candidate)?.element;
		return peer && peer.type === 'radio' && peer.name === element.name && formOwner(peer) === owner
			? [peer]
			: [];
	});
}

subscribeMutations((record) => {
	if (record.type === 'attributes') {
		const state = inputStates.get(record.target);
		state?.attributeChanged(record.attributeName ?? '');
		if (!['id', 'form'].includes(record.attributeName ?? '')) return;
	}
	if (record.type !== 'childList' && record.type !== 'attributes') return;
	const roots =
		record.type === 'childList'
			? [...(record.addedNodes ?? []), record.target.getRootNode(), ...(record.removedNodes ?? [])]
			: [record.target.getRootNode()];
	for (const root of roots)
		for (const element of formTree(root)) inputStates.get(element)?.enforceRadioGroup();
});

const floatingPoint = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function numberValue(value: string): number {
	return floatingPoint.test(value) && Number.isFinite(Number(value)) ? Number(value) : NaN;
}
const day = 86400000;
// oxlint-disable-next-line bombshell-dev/max-params -- Date construction uses the standard year/month/day components.
function utcDate(year: number, month: number, date: number): number {
	const value = new Date(0);
	value.setUTCFullYear(year, month, date);
	return value.getTime();
}
function dateNumber(value: string): number {
	const match = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return NaN;
	const year = Number(match[1]),
		month = Number(match[2]),
		date = Number(match[3]);
	const number = utcDate(year, month - 1, date);
	const parsed = new Date(number);
	return year > 0 &&
		parsed.getUTCFullYear() === year &&
		parsed.getUTCMonth() === month - 1 &&
		parsed.getUTCDate() === date
		? number
		: NaN;
}
function timeNumber(value: string): number {
	const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
	if (!match) return NaN;
	const hours = Number(match[1]),
		minutes = Number(match[2]),
		seconds = Number(match[3] ?? 0);
	return hours < 24 && minutes < 60 && seconds < 60
		? ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number((match[4] ?? '').padEnd(3, '0'))
		: NaN;
}
function weekStart(year: number): number {
	const jan4 = utcDate(year, 0, 4);
	return jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * day;
}
export function inputValueAsNumber(type: string, value: string): number {
	if (type === 'number' || type === 'range') return numberValue(value);
	if (type === 'date') return dateNumber(value);
	if (type === 'time') return timeNumber(value);
	if (type === 'datetime-local') {
		const parts = value.split(/[T ]/);
		return parts.length === 2 ? dateNumber(parts[0] ?? '') + timeNumber(parts[1] ?? '') : NaN;
	}
	if (type === 'month') {
		const match = /^(\d{4,})-(\d{2})$/.exec(value);
		if (!match || Number(match[1]) < 1 || Number(match[2]) < 1 || Number(match[2]) > 12) return NaN;
		return (Number(match[1]) - 1970) * 12 + Number(match[2]) - 1;
	}
	if (type === 'week') {
		const match = /^(\d{4,})-W(\d{2})$/.exec(value);
		if (!match || Number(match[1]) < 1) return NaN;
		const year = Number(match[1]),
			week = Number(match[2]);
		const time = weekStart(year) + (week - 1) * 7 * day;
		return week >= 1 && time < weekStart(year + 1) ? time : NaN;
	}
	return NaN;
}
const numericTypes = new Set([
	'number',
	'range',
	'date',
	'month',
	'week',
	'time',
	'datetime-local',
]);
export function supportsValueAsNumber(type: string): boolean {
	return numericTypes.has(type);
}
function pad(value: number, length = 2): string {
	return String(value).padStart(length, '0');
}
export function inputValueFromNumber(type: string, value: number): string {
	if (!Number.isFinite(value) && !Number.isNaN(value)) {
		// oxlint-disable-next-line bombshell-dev/no-generic-error -- The HTML numeric setter rejects infinity before checking the type.
		throw new TypeError('The numeric value must be finite');
	}
	if (!numericTypes.has(type))
		throw new DOMException('This input type does not support numeric values', 'InvalidStateError');
	if (Number.isNaN(value)) return '';
	if (type === 'number' || type === 'range') return String(value);
	if (type === 'month') {
		const year = 1970 + Math.floor(value / 12);
		return year > 0 ? `${pad(year, 4)}-${pad((((Math.trunc(value) % 12) + 12) % 12) + 1)}` : '';
	}
	const date = new Date(value);
	if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1) return '';
	const datePart = `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
	if (type === 'date') return datePart;
	if (type === 'week') {
		const thursday = new Date(
			utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) +
				(3 - ((date.getUTCDay() + 6) % 7)) * day,
		);
		const year = thursday.getUTCFullYear();
		return `${pad(year, 4)}-W${pad(Math.floor((thursday.getTime() - weekStart(year)) / (7 * day)) + 1)}`;
	}
	const seconds = date.getUTCSeconds(),
		millis = date.getUTCMilliseconds();
	const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}${seconds || millis ? `:${pad(seconds)}` : ''}${millis ? `.${pad(millis, 3).replace(/0+$/, '')}` : ''}`;
	return type === 'time' ? time : `${datePart}T${time}`;
}
export function inputValueAsDate(type: string, value: string): Date | null {
	if (!['date', 'month', 'week', 'time'].includes(type)) return null;
	const number = inputValueAsNumber(type, value);
	if (!Number.isFinite(number)) return null;
	return new Date(
		type === 'month'
			? utcDate(1970 + Math.floor(number / 12), ((number % 12) + 12) % 12, 1)
			: number,
	);
}
export function inputValueFromDate(type: string, value: Date | null): string {
	if (!['date', 'month', 'week', 'time'].includes(type))
		throw new DOMException('This input type does not support dates', 'InvalidStateError');
	if (value === null) return '';
	const date = new Date(Date.prototype.getTime.call(value));
	if (!Number.isFinite(date.getTime())) return '';
	return inputValueFromNumber(
		type,
		type === 'month' ? (date.getUTCFullYear() - 1970) * 12 + date.getUTCMonth() : date.getTime(),
	);
}

function stepParameters(element: HTMLInputElement): {
	step: number;
	base: number;
	min: number;
	max: number;
} {
	const type = element.type;
	const scale =
		type === 'date'
			? day
			: type === 'week'
				? 7 * day
				: ['time', 'datetime-local'].includes(type)
					? 1000
					: 1;
	const fallback = ['time', 'datetime-local'].includes(type) ? 60 : 1;
	const attribute = element.step.toLowerCase();
	const rawStep = numberValue(attribute);
	const step = attribute === 'any' ? NaN : (rawStep > 0 ? rawStep : fallback) * scale;
	const min = inputValueAsNumber(type, element.min),
		max = inputValueAsNumber(type, element.max);
	const defaultNumber = inputValueAsNumber(type, element.defaultValue);
	return {
		step,
		base: Number.isFinite(min)
			? min
			: Number.isFinite(defaultNumber)
				? defaultNumber
				: type === 'week'
					? -259200000
					: 0,
		min: Number.isFinite(min) ? min : type === 'range' ? 0 : -Infinity,
		max: Number.isFinite(max) ? max : type === 'range' ? 100 : Infinity,
	};
}
// oxlint-disable-next-line bombshell-dev/max-params -- Numeric step arithmetic has independent value, base, and quantum arguments.
function stepMismatch(value: number, base: number, step: number): boolean {
	if (!Number.isFinite(value) || !Number.isFinite(step)) return false;
	const quotient = (value - base) / step;
	return Math.abs(quotient - Math.round(quotient)) > 1e-7;
}
export function sanitizeInputValue(element: HTMLInputElement, value: string): string {
	const type = element.type;
	if (['text', 'search', 'tel', 'password', 'email', 'url'].includes(type))
		value = value.replace(/[\r\n]/g, '');
	if (type === 'url' || type === 'email') {
		const normalized = value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
		return type === 'email' && element.multiple
			? normalized
					.split(',')
					.map((part) => part.trim())
					.join(',')
			: normalized;
	}
	if (type === 'color') return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#000000';
	if (!numericTypes.has(type)) return value;
	let number = inputValueAsNumber(type, value);
	if (type !== 'range') {
		if (!Number.isFinite(number)) return '';
		return type === 'datetime-local' ? inputValueFromNumber(type, number) : value;
	}
	const { min, max, base, step } = stepParameters(element);
	if (!Number.isFinite(number)) number = max < min ? min : min + (max - min) / 2;
	number = Math.max(min, Math.min(max, number));
	if (Number.isFinite(step) && stepMismatch(number, base, step)) {
		const lower = base + Math.floor((number - base) / step) * step;
		const upper = lower + step;
		number =
			upper <= max && (lower < min || number - lower >= upper - number)
				? upper
				: lower >= min
					? lower
					: number;
	}
	return String(number);
}
export function stepInputValue(element: HTMLInputElement, amount: number): void {
	if (!numericTypes.has(element.type))
		throw new DOMException('This input type cannot step', 'InvalidStateError');
	const { min, max, base, step } = stepParameters(element);
	if (!Number.isFinite(step))
		throw new DOMException('An input with step=any cannot step', 'InvalidStateError');
	if (min > max) return;
	const count = Number(amount) | 0;
	let value = element.valueAsNumber;
	if (!Number.isFinite(value)) value = 0;
	const previous = value;
	if (stepMismatch(value, base, step)) {
		value =
			base +
			(count < 0 ? Math.floor((value - base) / step) : Math.ceil((value - base) / step)) * step;
		value += (count < 0 ? Math.min(0, count + 1) : Math.max(0, count - 1)) * step;
	} else value += count * step;
	if (value < min) value = base + Math.ceil((min - base) / step) * step;
	if (value > max) value = base + Math.floor((max - base) / step) * step;
	if (
		value < min ||
		value > max ||
		(count > 0 && value < previous) ||
		(count < 0 && value > previous)
	)
		return;
	element.valueAsNumber = Number(value.toPrecision(15));
}

export function textLengthValidity(element: Element, value: string): ValidityFlags {
	if (!controls.get(element)?.userEdited) return {};
	const lengthAttribute = (name: string): number => {
		const raw = element.getAttribute(name) ?? '';
		return /^\s*\+?\d+/.test(raw) ? Number.parseInt(raw, 10) : -1;
	};
	const min = lengthAttribute('minlength'),
		max = lengthAttribute('maxlength');
	return {
		tooLong: max >= 0 && value.length > max,
		tooShort: value.length > 0 && min >= 0 && value.length < min,
	};
}
export function inputValidity(element: HTMLInputElement): ValidityFlags {
	const type = element.type,
		value = element.value;
	const flags: ValidityFlags = {};
	const required = element.required && !(element.readOnly && supportsReadOnly(type));
	if (type === 'checkbox') flags.valueMissing = required && !element.checked;
	else if (type === 'radio') {
		const group = radioGroup(element);
		flags.valueMissing = group.some((peer) => peer.required) && !group.some((peer) => peer.checked);
	} else if (!['hidden', 'range', 'color', 'submit', 'image', 'reset', 'button'].includes(type))
		flags.valueMissing = required && !value;
	if (type === 'email' && value) {
		const email =
			/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
		flags.typeMismatch = (element.multiple ? value.split(',') : [value]).some(
			(part) => !email.test(part),
		);
	}
	if (type === 'url' && value) {
		flags.typeMismatch = !URL.canParse(value);
	}
	if (['text', 'search', 'tel', 'url', 'email', 'password'].includes(type)) {
		Object.assign(flags, textLengthValidity(element, value));
		const pattern = element.getAttribute('pattern');
		if (pattern !== null && value) {
			try {
				flags.patternMismatch = !new RegExp(`^(?:${pattern})$`, 'v').test(value);
			} catch {
				/* An invalid author pattern imposes no constraint. */
			}
		}
	}
	if (numericTypes.has(type) && value) {
		const number = element.valueAsNumber;
		const { min, max, base, step } = stepParameters(element);
		if (type === 'time' && min > max) {
			flags.rangeUnderflow = flags.rangeOverflow = number > max && number < min;
		} else {
			flags.rangeUnderflow = number < min;
			flags.rangeOverflow = number > max;
		}
		flags.stepMismatch = stepMismatch(number, base, step);
	}
	return flags;
}

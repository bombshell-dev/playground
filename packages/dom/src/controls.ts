import type { Element, Node } from './dom.ts';
import { Event } from './events.ts';
import { subscribeMutations } from './hooks.ts';

export type SelectionDirection = 'forward' | 'backward' | 'none';
export type SelectionMode = 'select' | 'start' | 'end' | 'preserve';

export interface TextControlOptions {
	element: Element;
	multiline: boolean;
	defaultValue: () => string;
	supportsSelection?: () => boolean;
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

	constructor(options: TextControlOptions) {
		this.#options = options;
		controls.set(options.element, this);
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
		this.#dirty = true;
		this.#value = normalized;
		if (normalized === previous) return;
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
		const start = unsigned(options.start === undefined ? this.selectionStart : options.start);
		const end = unsigned(options.end === undefined ? this.selectionEnd : options.end);
		if (start > end) throw new DOMException('The start is after the end', 'IndexSizeError');
		const from = Math.min(start, current.length);
		const to = Math.min(end, current.length);
		const added = this.#normalize(String(replacement));
		let selectedStart = this.selectionStart ?? 0;
		let selectedEnd = this.selectionEnd ?? 0;
		this.#dirty = true;
		this.#value = current.slice(0, from) + added + current.slice(to);
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
		if (this.#value !== current) this.#invalidate('mutation');
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

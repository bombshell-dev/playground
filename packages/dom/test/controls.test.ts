import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, HTMLInputElement, HTMLTextAreaElement } from '../src/dom.ts';
import { Event } from '../src/events.ts';

afterEach(() => vi.useRealTimers());

describe('text controls', () => {
	it.each(['input', 'textarea'] as const)(
		'clones dirty %s values without copying caret or listeners',
		(tag) => {
			const document = new Document();
			const source = document.createElement(tag);
			source.defaultValue = 'default';
			source.value = 'edited 😀';
			source.setSelectionRange(1, 4, 'backward');
			document.append(source);
			source.focus();
			const listener = vi.fn();
			source.addEventListener('custom', listener);
			const copy = source.cloneNode(true);
			if (!(copy instanceof HTMLInputElement || copy instanceof HTMLTextAreaElement))
				expect.unreachable();
			expect(copy.value).toBe('edited 😀');
			expect(copy.defaultValue).toBe('default');
			expect(copy.selectionStart).toBe(0);
			expect(copy.selectionEnd).toBe(0);
			expect(copy.selectionDirection).toBe('none');
			copy.dispatchEvent(new Event('custom'));
			expect(listener).not.toHaveBeenCalled();
			expect(document.activeElement).toBe(source);
			copy.defaultValue = 'different default';
			expect(copy.value).toBe('edited 😀');
			copy.value = 'independent';
			expect(source.value).toBe('edited 😀');
		},
	);

	it('preserves a pristine shallow textarea value separately from its empty default', () => {
		const document = new Document();
		const source = document.createElement('textarea');
		source.defaultValue = 'original';
		const copy = source.cloneNode(false);
		if (!(copy instanceof HTMLTextAreaElement)) expect.unreachable();
		expect(copy.childNodes).toHaveLength(0);
		expect(copy.defaultValue).toBe('');
		expect(copy.value).toBe('original');
		copy.defaultValue = '';
		expect(copy.value).toBe('');
		copy.defaultValue = 'replacement';
		expect(copy.value).toBe('replacement');
		expect(source.value).toBe('original');
	});

	it.each(['input', 'textarea'] as const)(
		'preserves the pristine %s flag across deep clone and import',
		(tag) => {
			const document = new Document();
			const destination = new Document();
			const source = document.createElement(tag);
			source.defaultValue = 'default';
			const copy = destination.importNode(source, true);
			if (!(copy instanceof HTMLInputElement || copy instanceof HTMLTextAreaElement))
				expect.unreachable();
			expect(copy.ownerDocument).toBe(destination);
			expect(copy.value).toBe('default');
			copy.defaultValue = 'updated';
			expect(copy.value).toBe('updated');
			expect(source.value).toBe('default');
		},
	);

	it('retains value and UTF-16 selection when an existing control moves between documents', () => {
		const source = new Document();
		const destination = new Document();
		const input = source.createElement('input');
		input.value = 'a😀b';
		input.setSelectionRange(1, 3, 'forward');
		source.append(input);
		destination.append(input);
		expect(input.ownerDocument).toBe(destination);
		expect(input.value).toBe('a😀b');
		expect(input.selectionStart).toBe(1);
		expect(input.selectionEnd).toBe(3);
		expect(input.selectionDirection).toBe('forward');
	});

	it('creates typed input/textarea subclasses with independent value selection', () => {
		const document = new Document();
		const input = document.createElement('input');
		const textarea = document.createElement('textarea');
		expect(input).toBeInstanceOf(HTMLInputElement);
		expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
		input.value = 'hello';
		textarea.value = 'world';
		input.setSelectionRange(1, 4, 'backward');
		expect(input.selectionStart).toBe(1);
		expect(input.selectionEnd).toBe(4);
		expect(input.selectionDirection).toBe('backward');
		expect(textarea.selectionStart).toBe(5);
	});

	it('uses UTF-16 units, clamps offsets, and collapses backward ranges to their end', () => {
		const input = new Document().createElement('input');
		input.value = 'a😀b';
		input.setSelectionRange(1, 3);
		expect(input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)).toBe('😀');
		input.setSelectionRange(99, 99);
		expect(input.selectionStart).toBe(4);
		input.setSelectionRange(3, 1);
		expect(input.selectionStart).toBe(1);
		expect(input.selectionEnd).toBe(1);
		input.selectionStart = 3;
		expect(input.selectionEnd).toBe(3);
		input.selectionEnd = 0;
		expect(input.selectionStart).toBe(0);
	});

	it('selects all without changing focus or firing input/change events', () => {
		const document = new Document();
		const input = document.createElement('input');
		input.value = 'text';
		const listener = vi.fn();
		input.addEventListener('input', listener);
		input.addEventListener('change', listener);
		input.select();
		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe(4);
		expect(document.focusManager.activeElement).toBeNull();
		expect(listener).not.toHaveBeenCalled();
	});

	it.each([
		['select', 2, 5],
		['start', 2, 2],
		['end', 5, 5],
		['preserve', 1, 7],
	] as const)('setRangeText applies %s selection mode', (mode, start, end) => {
		const input = new Document().createElement('input');
		input.value = 'abcdefgh';
		input.setSelectionRange(1, 6, 'backward');
		input.setRangeText('XYZ', 2, 4, mode);
		expect(input.value).toBe('abXYZefgh');
		expect(input.selectionStart).toBe(start);
		expect(input.selectionEnd).toBe(end);
		expect(input.selectionDirection).toBe('none');
	});

	it('setRangeText defaults to the selection and validates before modifying value', () => {
		const input = new Document().createElement('input');
		input.value = 'abcdef';
		input.setSelectionRange(2, 4);
		input.setRangeText('X');
		expect(input.value).toBe('abXef');
		expect(input.selectionStart).toBe(2);
		expect(input.selectionEnd).toBe(3);
		expect(() => input.setRangeText('broken', 5, 1)).toThrow(
			expect.objectContaining({ name: 'IndexSizeError' }),
		);
		expect(input.value).toBe('abXef');
	});

	it('returns null and throws InvalidStateError for selection on non-text input types', () => {
		const input = new Document().createElement('input');
		input.type = 'number';
		expect(input.selectionStart).toBeNull();
		expect(input.selectionEnd).toBeNull();
		expect(input.selectionDirection).toBeNull();
		expect(() => input.setSelectionRange(0, 1)).toThrow(
			expect.objectContaining({ name: 'InvalidStateError' }),
		);
		expect(() => input.setRangeText('1')).toThrow(
			expect.objectContaining({ name: 'InvalidStateError' }),
		);
		input.select();
	});

	it('normalizes input newlines and textarea CRLF while retaining dirty values', () => {
		const document = new Document();
		const input = document.createElement('input');
		input.defaultValue = 'initial';
		expect(input.value).toBe('initial');
		input.value = 'a\r\nb';
		input.defaultValue = 'new default';
		expect(input.value).toBe('ab');
		const textarea = document.createElement('textarea');
		textarea.defaultValue = 'first\r\nsecond';
		expect(textarea.value).toBe('first\nsecond');
		textarea.value = 'new\rline';
		expect(textarea.value).toBe('new\nline');
		expect(textarea.defaultValue).toBe('first\r\nsecond');
	});

	it('keeps the caret on same-value writes and moves it to the end on changed values', () => {
		const input = new Document().createElement('input');
		input.value = 'hello';
		input.setSelectionRange(1, 3);
		input.value = 'hello';
		expect(input.selectionStart).toBe(1);
		expect(input.selectionEnd).toBe(3);
		input.value = 'x';
		expect(input.selectionStart).toBe(1);
		expect(input.selectionEnd).toBe(1);
	});

	it('invalidates connected control state, with queued selection events', async () => {
		vi.useFakeTimers();
		const changes = vi.fn();
		const document = new Document({ onInvalidate: changes });
		const input = document.createElement('input');
		input.value = 'abcd';
		await vi.runAllTimersAsync();
		expect(changes).not.toHaveBeenCalled();
		document.append(input);
		changes.mockClear();
		const select = vi.fn();
		const selectionchange = vi.fn();
		input.addEventListener('select', select);
		input.addEventListener('selectionchange', selectionchange);
		input.setSelectionRange(0, 1);
		input.setSelectionRange(1, 2);
		expect(changes).toHaveBeenCalledWith({ kind: 'selection', target: input });
		expect(select).not.toHaveBeenCalled();
		await vi.runAllTimersAsync();
		expect(select).toHaveBeenCalledTimes(2);
		expect(selectionchange).toHaveBeenCalledOnce();
		input.remove();
		changes.mockClear();
		input.setSelectionRange(2, 3);
		expect(changes).not.toHaveBeenCalled();
	});
});

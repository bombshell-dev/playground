import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	Document,
	type Element,
	type HTMLInputElement,
	type HTMLTextAreaElement,
} from '../src/dom.ts';
import { InputEvent, KeyboardEvent } from '../src/events.ts';

function fixture(): {
	document: Document;
	root: Element;
	input: HTMLInputElement;
	textarea: HTMLTextAreaElement;
} {
	const document = new Document();
	const root = document.createElement('application');
	const input = document.createElement('input');
	const textarea = document.createElement('textarea');
	document.append(root);
	root.append(input, textarea);
	input.focus();
	return { document, root, input, textarea };
}

afterEach(() => vi.useRealTimers());

describe('host editing', () => {
	it('separates synthetic keyboard dispatch from host editing and delivers input event data', () => {
		const { document, input } = fixture();
		const events: InputEvent[] = [];
		for (const type of ['beforeinput', 'input'])
			input.addEventListener(type, (event) => {
				if (event instanceof InputEvent) events.push(event);
			});
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
		expect(input.value).toBe('');
		document.dispatch.keydown({ key: 'a' });
		expect(input.value).toBe('a');
		expect(
			events.map((event) => [
				event.type,
				event.inputType,
				event.data,
				event.cancelable,
				event.isTrusted,
			]),
		).toEqual([
			['beforeinput', 'insertText', 'a', true, false],
			['input', 'insertText', 'a', false, false],
		]);
	});

	it('honors keydown and beforeinput cancellation, readonly, and focus changes in callbacks', () => {
		const { document, input, textarea } = fixture();
		input.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
		document.dispatch.keydown({ key: 'a' });
		input.addEventListener('beforeinput', (event) => event.preventDefault(), { once: true });
		expect(document.dispatch.insertText('b')).toBe(false);
		input.readOnly = true;
		document.dispatch.keydown({ key: 'c' });
		input.readOnly = false;
		input.addEventListener('beforeinput', () => textarea.focus(), { once: true });
		document.dispatch.insertText('d');
		expect(input.value).toBe('');
		expect(textarea.value).toBe('');
	});

	it('uses UTF-16 selection offsets while navigation and deletion preserve grapheme clusters', () => {
		const { document, input } = fixture();
		document.dispatch.insertText('a👩‍💻e\u0301');
		expect(input.selectionStart).toBe(8);
		document.dispatch.keydown({ key: 'ArrowLeft' });
		expect(input.selectionStart).toBe(6);
		document.dispatch.keydown({ key: 'Backspace' });
		expect(input.value).toBe('ae\u0301');
		expect(input.selectionStart).toBe(1);
		document.dispatch.keydown({ key: 'Delete' });
		expect(input.value).toBe('a');
	});

	it('extends and replaces selections, supports multiline Enter and bounded host insertion', () => {
		const { document, input, textarea } = fixture();
		input.value = 'abcd';
		document.dispatch.keydown({ key: 'Home' });
		document.dispatch.keydown({ key: 'ArrowRight', shiftKey: true });
		document.dispatch.keydown({ key: 'ArrowRight', shiftKey: true });
		expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([
			0,
			2,
			'forward',
		]);
		document.dispatch.insertText('X');
		expect(input.value).toBe('Xcd');
		input.maxLength = 4;
		document.dispatch.keydown({ key: 'End' });
		document.dispatch.insertText('YZ');
		expect(input.value).toBe('XcdY');
		textarea.focus();
		document.dispatch.insertText('one');
		document.dispatch.keydown({ key: 'Enter' });
		document.dispatch.insertText('two');
		expect(textarea.value).toBe('one\ntwo');
	});

	it('commits user changes on blur or Enter, once per changed edit session', () => {
		const { document, input, textarea } = fixture();
		const change = vi.fn();
		input.addEventListener('change', change);
		input.value = 'script';
		textarea.focus();
		expect(change).not.toHaveBeenCalled();
		input.focus();
		document.dispatch.insertText('!');
		document.dispatch.keydown({ key: 'Enter' });
		expect(change).toHaveBeenCalledOnce();
		textarea.focus();
		expect(change).toHaveBeenCalledOnce();
		input.focus();
		document.dispatch.insertText('?');
		textarea.focus();
		expect(change).toHaveBeenCalledTimes(2);
	});

	it('does not edit composition keystrokes or reserved shortcuts', () => {
		const { document, input } = fixture();
		document.dispatch.keydown({ key: 'a', isComposing: true });
		document.dispatch.keydown({ key: 'c', ctrlKey: true });
		expect(input.value).toBe('');
		input.value = 'whole';
		document.dispatch.keydown({ key: 'a', metaKey: true });
		expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
	});

	it('activates Enter immediately and Space on matching uncanceled keyup', () => {
		const { document, root } = fixture();
		const button = document.createElement('button');
		root.append(button);
		button.focus();
		const click = vi.fn();
		button.addEventListener('click', click);
		document.dispatch.keydown({ key: 'Enter' });
		expect(click).toHaveBeenCalledOnce();
		document.dispatch.keydown({ key: ' ' });
		expect(click).toHaveBeenCalledOnce();
		document.dispatch.keyup({ key: ' ' });
		expect(click).toHaveBeenCalledTimes(2);
		document.dispatch.keydown({ key: ' ' });
		button.addEventListener('keyup', (event) => event.preventDefault(), { once: true });
		document.dispatch.keyup({ key: ' ' });
		expect(click).toHaveBeenCalledTimes(2);
	});

	it('navigates and activates a named radio group with arrow keys', () => {
		const { document, root } = fixture();
		const first = document.createElement('input');
		const second = document.createElement('input');
		first.type = second.type = 'radio';
		first.name = second.name = 'choice';
		root.append(first, second);
		first.focus();
		first.checked = true;
		document.dispatch.keydown({ key: 'ArrowRight' });
		expect(document.activeElement).toBe(second);
		expect([first.checked, second.checked]).toEqual([false, true]);
		expect(document.focusManager.focusableElements()).toContain(second);
		expect(document.focusManager.focusableElements()).not.toContain(first);
	});

	it('processes autofocus once per document and preserves explicit focus', async () => {
		vi.useFakeTimers();
		const document = new Document();
		const root = document.createElement('application');
		const input = document.createElement('input');
		input.setAttribute('autofocus', '');
		root.append(input);
		expect(document.activeElement).toBe(null);
		document.append(root);
		await vi.runAllTimersAsync();
		expect(document.activeElement).toBe(input);
		const later = document.createElement('button');
		later.setAttribute('autofocus', '');
		root.append(later);
		await vi.runAllTimersAsync();
		expect(document.activeElement).toBe(input);
		const other = fixture();
		other.textarea.setAttribute('autofocus', '');
		await vi.runAllTimersAsync();
		expect(other.document.activeElement).toBe(other.input);
	});

	it('replaces a document selection across mixed editable text and element boundaries', () => {
		const { document, root } = fixture();
		const editor = document.createElement('box');
		editor.contentEditable = 'plaintext-only';
		const first = document.createTextNode('hello ');
		const emphasized = document.createElement('strong');
		const last = document.createTextNode('world');
		emphasized.append(last);
		editor.append(first, emphasized);
		root.append(editor);
		editor.focus();
		const selection = document.getSelection();
		selection.setBaseAndExtent(first, 3, last, 2);
		const events: string[] = [];
		editor.addEventListener('beforeinput', (event) => events.push(event.type));
		editor.addEventListener('input', (event) => events.push(event.type));
		expect(document.dispatch.insertText('X')).toBe(true);
		expect(editor.textContent).toBe('helXrld');
		expect(first.data).toBe('hel');
		expect(last.data).toBe('rld');
		expect(selection.isCollapsed).toBe(true);
		expect(events).toEqual(['beforeinput', 'input']);
		document.dispatch.keydown({ key: 'Backspace' });
		expect(editor.textContent).toBe('helrld');
	});

	it('protects noneditable islands and honors canceled editable input', () => {
		const { document, root } = fixture();
		const editor = document.createElement('box');
		editor.contentEditable = 'true';
		const protectedElement = document.createElement('span');
		protectedElement.contentEditable = 'false';
		const protectedText = document.createTextNode('protected');
		protectedElement.append(protectedText);
		editor.append('before', protectedElement, 'after');
		root.append(editor);
		editor.focus();
		const selection = document.getSelection();
		selection.collapse(protectedText, 2);
		expect(document.dispatch.insertText('X')).toBe(false);
		selection.selectAllChildren(editor);
		expect(document.dispatch.insertText('X')).toBe(false);
		expect(protectedText.data).toBe('protected');
		selection.collapse(editor, 0);
		editor.addEventListener('beforeinput', (event) => event.preventDefault(), { once: true });
		expect(document.dispatch.insertText('X')).toBe(false);
		expect(editor.textContent).toBe('beforeprotectedafter');
	});

	it('inserts plaintext line breaks and navigates editable grapheme boundaries', () => {
		const { document, root } = fixture();
		const editor = document.createElement('box');
		editor.contentEditable = 'true';
		root.append(editor);
		editor.focus();
		document.dispatch.insertText('a😀');
		document.dispatch.keydown({ key: 'ArrowLeft', shiftKey: true });
		expect(document.getSelection().toString()).toBe('😀');
		document.dispatch.insertText('b');
		document.dispatch.keydown({ key: 'Enter' });
		expect(editor.textContent).toBe('ab\n');
	});
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, type Element } from '../src/dom.ts';
import { Event, ToggleEvent } from '../src/events.ts';
import { isFocusable } from '../src/focus.ts';

function fixture(): { document: Document; root: Element } {
	const document = new Document();
	const root = document.createElement('application');
	document.append(root);
	return { document, root };
}

afterEach(() => vi.useRealTimers());

describe('details and summary', () => {
	it('activates only the first summary, preserves click cancellation and interactive descendants', () => {
		const { document, root } = fixture();
		const details = document.createElement('details');
		const first = document.createElement('summary');
		const second = document.createElement('summary');
		const label = document.createElement('span');
		const button = document.createElement('button');
		first.append(label, button);
		details.append(first, second);
		root.append(details);
		expect(first.tabIndex).toBe(0);
		expect(second.tabIndex).toBe(-1);
		second.click();
		expect(details.open).toBe(false);
		label.click();
		expect(details.open).toBe(true);
		button.click();
		expect(details.open).toBe(true);
		first.addEventListener('click', (event) => event.preventDefault(), { once: true });
		first.click();
		expect(details.open).toBe(true);
		first.click();
		expect(details.open).toBe(false);
	});

	it('coalesces toggle tasks and excludes collapsed content from focus', async () => {
		vi.useFakeTimers();
		const { document, root } = fixture();
		const details = document.createElement('details');
		const summary = document.createElement('summary');
		const input = document.createElement('input');
		details.append(summary, input);
		root.append(details);
		const events: ToggleEvent[] = [];
		details.addEventListener('toggle', (event) => {
			if (event instanceof ToggleEvent) events.push(event);
		});
		expect(isFocusable(input)).toBe(false);
		expect(isFocusable(summary)).toBe(true);
		details.open = true;
		input.focus();
		expect(document.activeElement).toBe(input);
		details.open = false;
		expect(document.activeElement).toBe(root);
		details.open = true;
		expect(events).toHaveLength(0);
		await vi.runAllTimersAsync();
		expect(events).toHaveLength(1);
		expect([events[0]?.oldState, events[0]?.newState, events[0]?.bubbles]).toEqual([
			'closed',
			'open',
			false,
		]);
	});

	it('enforces named exclusivity for opening, regrouping, and subtree insertion', () => {
		const { document, root } = fixture();
		const first = document.createElement('details');
		const second = document.createElement('details');
		first.name = second.name = 'group';
		root.append(first, second);
		first.open = true;
		second.open = true;
		expect(first.open).toBe(false);
		first.name = 'other';
		first.open = true;
		first.name = 'group';
		expect(first.open).toBe(false);
		const detached = document.createElement('details');
		detached.name = 'group';
		detached.open = true;
		root.append(detached);
		expect(detached.open).toBe(false);
		expect(second.open).toBe(true);
	});

	it('keeps exclusive groups scoped to a tree including independent shadow roots', () => {
		const { document, root } = fixture();
		const first = document.createElement('details');
		first.name = 'group';
		first.open = true;
		root.append(first);
		const host = document.createElement('box');
		root.append(host);
		const second = document.createElement('details');
		second.name = 'group';
		host.attachShadow({ mode: 'open' }).append(second);
		second.open = true;
		expect(first.open && second.open).toBe(true);
	});
});

describe('dialogs', () => {
	it('focuses autofocus content, traps modal navigation, restores previous focus and queues close', async () => {
		vi.useFakeTimers();
		const { document, root } = fixture();
		const outside = document.createElement('button');
		const dialog = document.createElement('dialog');
		const first = document.createElement('input');
		const preferred = document.createElement('button');
		preferred.setAttribute('autofocus', '');
		dialog.append(first, preferred);
		root.append(outside, dialog);
		outside.focus();
		const close = vi.fn();
		dialog.addEventListener('close', close);
		dialog.showModal();
		expect(document.activeElement).toBe(preferred);
		expect(dialog.closedBy).toBe('closerequest');
		outside.focus();
		expect(document.activeElement).toBe(preferred);
		expect(document.focusManager.focusableElements()).toEqual([first, preferred]);
		document.dispatch.keydown({ key: 'Tab' });
		expect(document.activeElement).toBe(first);
		dialog.close('accepted');
		expect(dialog.returnValue).toBe('accepted');
		expect(document.activeElement).toBe(outside);
		expect(close).not.toHaveBeenCalled();
		await vi.runAllTimersAsync();
		expect(close).toHaveBeenCalledOnce();
	});

	it('supports cancelable beforetoggle and requestClose, including closedby=none', () => {
		const { document, root } = fixture();
		const dialog = document.createElement('dialog');
		root.append(dialog);
		dialog.addEventListener('beforetoggle', (event) => event.preventDefault(), { once: true });
		dialog.showModal();
		expect(dialog.open).toBe(false);
		dialog.showModal();
		expect(document.activeElement).toBe(dialog);
		dialog.closedBy = 'none';
		document.dispatch.keydown({ key: 'Escape' });
		expect(dialog.open).toBe(true);
		dialog.addEventListener('cancel', (event) => event.preventDefault(), { once: true });
		dialog.requestClose('cancelled');
		expect(dialog.open).toBe(true);
		expect(dialog.returnValue).toBe('');
		dialog.requestClose('accepted');
		expect(dialog.open).toBe(false);
		expect(dialog.returnValue).toBe('accepted');
	});

	it('rejects invalid mode transitions, permits repeated show, and requires modal connectivity', () => {
		const { document, root } = fixture();
		const dialog = document.createElement('dialog');
		expect(() => dialog.showModal()).toThrow('connected');
		dialog.show();
		dialog.show();
		expect(() => dialog.showModal()).toThrow('different mode');
		dialog.close();
		root.append(dialog);
		dialog.showModal();
		dialog.showModal();
		expect(() => dialog.show()).toThrow('different mode');
	});

	it('cleans removed modal subtrees and leaves other documents independent', () => {
		const first = fixture();
		const second = fixture();
		const firstButton = first.document.createElement('button');
		const secondButton = second.document.createElement('button');
		const wrapper = first.document.createElement('box');
		const dialog = first.document.createElement('dialog');
		wrapper.append(dialog);
		first.root.append(firstButton, wrapper);
		second.root.append(secondButton);
		dialog.showModal();
		secondButton.focus();
		expect(second.document.activeElement).toBe(secondButton);
		wrapper.remove();
		firstButton.focus();
		expect(first.document.activeElement).toBe(firstButton);
		expect(dialog.open).toBe(true);
		first.root.append(wrapper);
		expect(dialog.closedBy).toBe('none');
	});

	it('restores nested modal focus in reverse order', () => {
		const { document, root } = fixture();
		const outside = document.createElement('button');
		const outer = document.createElement('dialog');
		const inner = document.createElement('dialog');
		const outerButton = document.createElement('button');
		outer.append(outerButton);
		root.append(outside, outer, inner);
		outside.focus();
		outer.showModal();
		inner.showModal();
		expect(document.activeElement).toBe(inner);
		inner.close();
		expect(document.activeElement).toBe(outerButton);
		outer.close();
		expect(document.activeElement).toBe(outside);
	});

	it('releases modal state inside a removed shadow host', () => {
		const { document, root } = fixture();
		const button = document.createElement('button');
		const host = document.createElement('box');
		const dialog = document.createElement('dialog');
		host.attachShadow({ mode: 'closed' }).append(dialog);
		root.append(button, host);
		dialog.showModal();
		expect(isFocusable(button)).toBe(false);
		host.remove();
		expect(isFocusable(button)).toBe(true);
		expect(dialog.closedBy).toBe('none');
	});

	it('retains modal blocking after raw open removal, until the dialog is removed', () => {
		const { document, root } = fixture();
		const button = document.createElement('button');
		const dialog = document.createElement('dialog');
		root.append(button, dialog);
		dialog.showModal();
		dialog.open = false;
		expect(isFocusable(button)).toBe(false);
		dialog.remove();
		expect(isFocusable(button)).toBe(true);
	});

	it('does not interpret a synthetic cancel event as a request to close', () => {
		const { document, root } = fixture();
		const dialog = document.createElement('dialog');
		root.append(dialog);
		dialog.showModal();
		dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
		expect(dialog.open).toBe(true);
	});
});

import { describe, expect, it, vi } from 'vitest';
import { Document, type Element, type HTMLInputElement } from '../src/dom.ts';
import { Event, FocusEvent, KeyboardEvent } from '../src/events.ts';
import { Dispatch } from '../src/focus.ts';

function fixture(): {
	document: Document;
	root: Element;
	first: Element;
	second: HTMLInputElement;
	changes: ReturnType<typeof vi.fn>;
} {
	const changes = vi.fn();
	const document = new Document({ onInvalidate: changes });
	const root = document.createElement('box');
	const first = document.createElement('button');
	const second = document.createElement('input');
	document.appendChild(root);
	root.append(first, second);
	changes.mockClear();
	return { document, root, first, second, changes };
}

describe('focus', () => {
	it('moves focus with ordered events, related targets, and rendering invalidation', () => {
		const { document, root, first, second, changes } = fixture();
		const calls: string[] = [];
		first.focus();
		for (const name of ['blur', 'focusout', 'focus', 'focusin']) {
			root.addEventListener(
				name,
				(event) => {
					expect(event).toBeInstanceOf(FocusEvent);
					if (!(event instanceof FocusEvent)) return;
					calls.push(`${event.target === first ? 'first' : 'second'} ${name}`);
					expect(event.relatedTarget).toBe(event.target === first ? second : first);
				},
				true,
			);
		}
		calls.length = 0;
		changes.mockClear();
		second.focus();
		expect(document.activeElement).toBe(second);
		expect(calls).toEqual(['first blur', 'first focusout', 'second focus', 'second focusin']);
		expect(changes).toHaveBeenCalledWith({ kind: 'focus', target: first });
		expect(changes).toHaveBeenCalledWith({ kind: 'focus', target: second });
	});

	it('does nothing on repeated focus or blur of an unfocused element', () => {
		const { first, second, changes } = fixture();
		first.focus();
		const focus = vi.fn();
		first.addEventListener('focus', focus);
		changes.mockClear();
		first.focus();
		second.blur();
		expect(focus).not.toHaveBeenCalled();
		expect(changes).not.toHaveBeenCalled();
	});

	it('distinguishes dispatching a focus event from changing focus', () => {
		const { document, root, first, changes } = fixture();
		first.dispatchEvent(new FocusEvent('focus'));
		expect(document.activeElement).toBe(root);
		expect(changes).not.toHaveBeenCalled();
	});

	it('rejects detached, disabled, hidden, inert, and ineligible nodes', () => {
		const { document, root, first, second } = fixture();
		const detached = document.createElement('button');
		detached.focus();
		root.focus();
		first.setAttribute('disabled', '');
		first.focus();
		second.setAttribute('hidden', '');
		second.focus();
		expect(document.activeElement).toBe(root);
		second.removeAttribute('hidden');
		root.setAttribute('inert', '');
		second.focus();
		expect(document.activeElement).toBe(root);
	});

	it('permits tabindex=-1 programmatic focus but excludes it from navigation', () => {
		const { document, root, first, second } = fixture();
		const custom = document.createElement('text');
		custom.tabIndex = -1;
		root.append(custom);
		custom.focus();
		expect(document.activeElement).toBe(custom);
		expect(document.focusManager.focusableElements()).toEqual([first, second]);
	});

	it('orders positive tabindex first with stable tree order then zero defaults', () => {
		const { document, root, first, second } = fixture();
		const a = document.createElement('box');
		const b = document.createElement('box');
		const c = document.createElement('box');
		a.tabIndex = 2;
		b.tabIndex = c.tabIndex = 1;
		root.append(a, b, c);
		expect(document.focusManager.focusableElements()).toEqual([b, c, a, first, second]);
	});

	it('orders tabindex within shadow and slot scopes before flattening them', () => {
		const { document, root, first, second } = fixture();
		first.tabIndex = 3;
		const host = document.createElement('box');
		const shadow = host.attachShadow({ mode: 'open' });
		const beforeSlot = document.createElement('input');
		const slot = document.createElement('slot');
		const assigned = document.createElement('input');
		assigned.tabIndex = 1;
		shadow.append(beforeSlot, slot);
		host.append(assigned);
		root.append(host);
		expect(document.focusManager.focusableElements()).toEqual([
			first,
			second,
			beforeSlot,
			assigned,
		]);
		host.tabIndex = 2;
		expect(document.focusManager.focusableElements()).toEqual([
			host,
			beforeSlot,
			assigned,
			first,
			second,
		]);
	});

	it('omits negative-tabindex shadow/slot scopes from sequential focus', () => {
		const { document, root, first, second } = fixture();
		const host = document.createElement('box');
		const shadow = host.attachShadow({ mode: 'open' });
		const slot = document.createElement('slot');
		const assigned = document.createElement('input');
		shadow.append(slot);
		host.append(assigned);
		root.append(host);
		slot.tabIndex = -1;
		expect(document.focusManager.focusableElements()).toEqual([first, second]);
		slot.removeAttribute('tabindex');
		host.tabIndex = -1;
		expect(document.focusManager.focusableElements()).toEqual([first, second]);
		assigned.focus();
		expect(document.activeElement).toBe(assigned);
	});

	it('continues in tree order from a programmatically focused negative-tabindex element', () => {
		const { document, root, first, second } = fixture();
		const programmatic = document.createElement('box');
		programmatic.tabIndex = -1;
		root.insertBefore(programmatic, second);
		programmatic.focus();
		document.focusManager.moveFocus();
		expect(document.activeElement).toBe(second);
		programmatic.focus();
		document.focusManager.moveFocus(true);
		expect(document.activeElement).toBe(first);
	});

	it('reflects tabindex independently of focus eligibility', () => {
		const { document, root } = fixture();
		const anchor = document.createElement('a');
		const custom = document.createElement('box');
		root.append(anchor, custom);
		expect(anchor.tabIndex).toBe(0);
		anchor.focus();
		expect(document.activeElement).toBe(root);
		custom.setAttribute('tabindex', '2147483648');
		expect(custom.tabIndex).toBe(-1);
		custom.focus();
		expect(document.activeElement).toBe(custom);
	});

	it('silently clears focus when a focused subtree is removed', () => {
		const { document, root, first, changes } = fixture();
		first.focus();
		const blur = vi.fn();
		first.addEventListener('blur', blur);
		changes.mockClear();
		first.remove();
		expect(document.activeElement).toBe(root);
		expect(document.focusManager.activeElement).toBeNull();
		expect(blur).not.toHaveBeenCalled();
		expect(changes).toHaveBeenCalledWith({ kind: 'focus', target: first });
		root.append(first);
		expect(document.activeElement).toBe(root);
	});

	it('allows a nested focus transition to supersede an outer transition', () => {
		const { document, root, first, second } = fixture();
		const third = document.createElement('button');
		root.append(third);
		first.focus();
		first.addEventListener('blur', () => third.focus());
		const stale = vi.fn();
		second.addEventListener('focus', stale);
		second.focus();
		expect(document.activeElement).toBe(third);
		expect(stale).not.toHaveBeenCalled();
	});

	it('handles disabled fieldsets with the first-legend exception', () => {
		const { document, root } = fixture();
		const fieldset = document.createElement('fieldset');
		const legend = document.createElement('legend');
		const allowed = document.createElement('button');
		const blocked = document.createElement('button');
		fieldset.setAttribute('disabled', '');
		legend.append(allowed);
		fieldset.append(legend, blocked);
		root.append(fieldset);
		allowed.focus();
		expect(document.activeElement).toBe(allowed);
		blocked.focus();
		expect(document.activeElement).toBe(allowed);
	});

	it('keeps focus independent across documents', () => {
		const first = fixture();
		const second = fixture();
		first.first.focus();
		second.second.focus();
		expect(first.document.activeElement).toBe(first.first);
		expect(second.document.activeElement).toBe(second.second);
	});

	it('retargets shadow focus to hosts and supports delegated focus', () => {
		const { document, root } = fixture();
		const host = document.createElement('box');
		const shadow = host.attachShadow({ mode: 'closed', delegatesFocus: true });
		const input = document.createElement('input');
		shadow.append(input);
		root.append(host);
		host.focus();
		expect(document.activeElement).toBe(host);
		expect(shadow.activeElement).toBe(input);
		expect(document.focusManager.activeElement).toBe(input);
		host.remove();
		expect(shadow.activeElement).toBeNull();
	});

	it('preserves an existing delegate and forwards host.blur to its focused shadow descendant', () => {
		const { document, root } = fixture();
		const host = document.createElement('box');
		const shadow = host.attachShadow({ mode: 'open', delegatesFocus: true });
		const first = document.createElement('input');
		const second = document.createElement('input');
		shadow.append(first, second);
		root.append(host);
		second.focus();
		const focus = vi.fn();
		second.addEventListener('focus', focus);
		host.focus();
		expect(shadow.activeElement).toBe(second);
		expect(focus).not.toHaveBeenCalled();
		host.blur();
		expect(document.focusManager.activeElement).toBeNull();
	});

	it('delegates through delegating roots and honors autofocus without crossing other roots', () => {
		const { document, root } = fixture();
		const host = document.createElement('box');
		const shadow = host.attachShadow({ mode: 'open', delegatesFocus: true });
		const nestedHost = document.createElement('box');
		const nested = nestedHost.attachShadow({ mode: 'open' });
		const inaccessible = document.createElement('input');
		nested.append(inaccessible);
		const first = document.createElement('input');
		const preferred = document.createElement('input');
		preferred.setAttribute('autofocus', '');
		shadow.append(nestedHost, first, preferred);
		root.append(host);
		host.focus();
		expect(document.focusManager.activeElement).toBe(preferred);
		preferred.removeAttribute('autofocus');
		host.blur();
		host.focus();
		expect(document.focusManager.activeElement).toBe(first);
	});

	it('navigates assigned slot content in composition order and skips unassigned light children', () => {
		const { document, root, first, second } = fixture();
		const host = document.createElement('box');
		const shadow = host.attachShadow({ mode: 'closed' });
		const slot = document.createElement('slot');
		slot.name = 'controls';
		const inner = document.createElement('input');
		const assigned = document.createElement('input');
		const unassigned = document.createElement('input');
		assigned.slot = 'controls';
		shadow.append(inner, slot);
		host.append(assigned, unassigned);
		root.append(host);
		expect(document.focusManager.focusableElements()).toEqual([first, second, inner, assigned]);
		assigned.focus();
		expect(document.activeElement).toBe(assigned);
		unassigned.focus();
		expect(document.activeElement).toBe(assigned);
		host.remove();
		expect(document.focusManager.activeElement).toBeNull();
	});
});

describe('host input dispatch', () => {
	it('routes keydown/keyup to focus and Tab navigation only through Dispatch', () => {
		const { document, first, second } = fixture();
		const dispatch = new Dispatch(document);
		const calls: string[] = [];
		first.addEventListener('keydown', (event) => {
			expect(event).toBeInstanceOf(KeyboardEvent);
			expect(event.isTrusted).toBe(false);
			calls.push('first down');
		});
		second.addEventListener('keyup', () => calls.push('second up'));
		first.focus();
		first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
		expect(document.activeElement).toBe(first);
		expect(dispatch.keydown({ key: 'Tab' })).toBe(true);
		expect(document.activeElement).toBe(second);
		expect(dispatch.keyup({ key: 'Tab' })).toBe(true);
		expect(calls).toEqual(['first down', 'first down', 'second up']);
		dispatch.keydown({ key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(first);
	});

	it('respects canceled Tab and leaves other key default actions to consumers', () => {
		const { document, first } = fixture();
		const dispatch = new Dispatch(document);
		first.focus();
		first.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
		expect(dispatch.keydown({ key: 'Tab' })).toBe(false);
		expect(document.activeElement).toBe(first);
		dispatch.keydown({ key: 'Tab', ctrlKey: true });
		dispatch.keydown({ key: 'Enter' });
		expect(document.activeElement).toBe(first);
	});

	it('wraps logical navigation and chooses a candidate when nothing is focused', () => {
		const { document, first, second } = fixture();
		const dispatch = new Dispatch(document);
		dispatch.keydown({ key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(second);
		dispatch.keydown({ key: 'Tab' });
		expect(document.activeElement).toBe(first);
		first.blur();
		dispatch.keydown({ key: 'Tab' });
		expect(document.activeElement).toBe(first);
	});

	it('does not invalidate rendering merely by dispatching a keyboard event', () => {
		const { document, first, changes } = fixture();
		first.focus();
		changes.mockClear();
		new Dispatch(document).keydown({ key: 'ArrowRight' });
		first.dispatchEvent(new Event('arbitrary'));
		expect(changes).not.toHaveBeenCalled();
	});
});

import { describe, expect, it, vi } from 'vitest';
import { Document } from '../src/dom.ts';
import { Event, FocusEvent, type EventTarget } from '../src/events.ts';

describe('shadow event dispatch', () => {
	it.each(['open', 'closed'] as const)('retargets composed events across a %s root', (mode) => {
		const document = new Document();
		const host = document.createElement('box');
		const shadow = host.attachShadow({ mode });
		const target = document.createElement('button');
		document.append(host);
		shadow.append(target);
		const calls: string[] = [];
		const inside: EventTarget[][] = [];
		const outside: EventTarget[][] = [];
		target.addEventListener('x', (event) => {
			calls.push('target');
			expect(event.target).toBe(target);
			inside.push(event.composedPath());
		});
		shadow.addEventListener('x', (event) => expect(event.target).toBe(target));
		host.addEventListener('x', (event) => {
			calls.push('host');
			expect(event.target).toBe(host);
			expect(event.eventPhase).toBe(Event.AT_TARGET);
			outside.push(event.composedPath());
		});
		document.addEventListener('x', (event) => {
			calls.push('document');
			expect(event.target).toBe(host);
			expect(event.eventPhase).toBe(Event.BUBBLING_PHASE);
		});
		const event = new Event('x', { bubbles: true, composed: true });
		target.dispatchEvent(event);
		expect(calls).toEqual(['target', 'host', 'document']);
		expect(inside).toEqual([[target, shadow, host, document]]);
		expect(outside).toEqual([
			mode === 'open' ? [target, shadow, host, document] : [host, document],
		]);
		expect(event.target).toBe(host);
		expect(event.composedPath()).toEqual([]);
	});

	it('keeps non-composed events inside their original shadow root and clears references', () => {
		const document = new Document();
		const host = document.createElement('box');
		const shadow = host.attachShadow({ mode: 'open' });
		const target = document.createElement('button');
		const related = document.createElement('button');
		document.append(host);
		shadow.append(target, related);
		const escaped = vi.fn();
		host.addEventListener('focusout', escaped);
		const event = new FocusEvent('focusout', { bubbles: true, relatedTarget: related });
		shadow.addEventListener('focusout', (observed) =>
			expect(observed.composedPath()).toEqual([target, shadow]),
		);
		target.dispatchEvent(event);
		expect(escaped).not.toHaveBeenCalled();
		expect(event.target).toBeNull();
		expect(event.relatedTarget).toBeNull();
	});

	it('delivers non-bubbling composed events at hosts in both target phases', () => {
		const document = new Document();
		const host = document.createElement('box');
		const shadow = host.attachShadow({ mode: 'open' });
		const target = document.createElement('button');
		document.append(host);
		shadow.append(target);
		const calls: string[] = [];
		document.addEventListener('x', () => calls.push('document capture'), true);
		document.addEventListener('x', () => calls.push('document bubble'));
		host.addEventListener(
			'x',
			(event) => {
				calls.push('host capture');
				expect(event.eventPhase).toBe(Event.AT_TARGET);
			},
			true,
		);
		host.addEventListener('x', (event) => {
			calls.push('host bubble');
			expect(event.eventPhase).toBe(Event.AT_TARGET);
		});
		target.addEventListener('x', () => calls.push('target'));
		target.dispatchEvent(new Event('x', { composed: true }));
		expect(calls).toEqual(['document capture', 'host capture', 'target', 'host bubble']);
	});

	it('suppresses outer focus transitions when both related targets retarget to the same host', () => {
		const document = new Document();
		const host = document.createElement('box');
		const shadow = host.attachShadow({ mode: 'open' });
		const first = document.createElement('input');
		const second = document.createElement('input');
		document.append(host);
		shadow.append(first, second);
		first.focus();
		const outer = vi.fn();
		const inside: string[] = [];
		host.addEventListener('focusout', outer);
		host.addEventListener('focusin', outer);
		shadow.addEventListener('focusout', () => inside.push('out'));
		shadow.addEventListener('focusin', () => inside.push('in'));
		second.focus();
		expect(inside).toEqual(['out', 'in']);
		expect(outer).not.toHaveBeenCalled();
	});

	it('retargets relatedTarget when focus enters or leaves a shadow tree', () => {
		const document = new Document();
		const root = document.createElement('box');
		const host = document.createElement('box');
		const shadow = host.attachShadow({ mode: 'open' });
		const inner = document.createElement('input');
		const outer = document.createElement('input');
		document.append(root);
		root.append(host, outer);
		shadow.append(inner);
		const observations: unknown[] = [];
		root.addEventListener('focusin', (event) => {
			if (event instanceof FocusEvent) observations.push([event.target, event.relatedTarget]);
		});
		outer.focus();
		inner.focus();
		outer.focus();
		expect(observations).toEqual([
			[outer, null],
			[host, outer],
			[outer, host],
		]);
	});

	it('captures visibility and retargeting before listeners move the target outside the root', () => {
		const document = new Document();
		const root = document.createElement('box');
		const host = document.createElement('box');
		const shadow = host.attachShadow({ mode: 'closed' });
		const target = document.createElement('button');
		document.append(root);
		root.append(host);
		shadow.append(target);
		root.addEventListener('x', () => root.append(target), true);
		host.addEventListener('x', (event) => {
			expect(event.target).toBe(host);
			expect(event.composedPath()).toEqual([host, root, document]);
		});
		target.addEventListener('x', (event) => {
			expect(event.target).toBe(target);
			expect(event.composedPath()).toEqual([target, shadow, host, root, document]);
		});
		target.dispatchEvent(new Event('x', { bubbles: true, composed: true }));
	});

	it.each(['open', 'closed'] as const)(
		'routes slotted light-tree events through a %s root even without composed',
		(mode) => {
			const document = new Document();
			const host = document.createElement('box');
			const shadow = host.attachShadow({ mode });
			const slot = document.createElement('slot');
			const target = document.createElement('button');
			document.append(host);
			shadow.append(slot);
			host.append(target);
			const calls: string[] = [];
			slot.addEventListener('x', (event) => {
				calls.push('slot');
				expect(event.target).toBe(target);
				expect(event.composedPath()).toEqual([target, slot, shadow, host, document]);
			});
			host.addEventListener('x', (event) => {
				calls.push('host');
				expect(event.target).toBe(target);
				expect(event.composedPath()).toEqual(
					mode === 'open' ? [target, slot, shadow, host, document] : [target, host, document],
				);
			});
			target.dispatchEvent(new Event('x', { bubbles: true }));
			expect(calls).toEqual(['slot', 'host']);
		},
	);

	it('hides each nested closed root according to the current listener', () => {
		const document = new Document();
		const outerHost = document.createElement('box');
		const outerRoot = outerHost.attachShadow({ mode: 'closed' });
		const innerHost = document.createElement('box');
		const innerRoot = innerHost.attachShadow({ mode: 'closed' });
		const target = document.createElement('input');
		document.append(outerHost);
		outerRoot.append(innerHost);
		innerRoot.append(target);
		const paths: EventTarget[][] = [];
		target.addEventListener('x', (event) => paths.push(event.composedPath()));
		innerHost.addEventListener('x', (event) => paths.push(event.composedPath()));
		outerHost.addEventListener('x', (event) => paths.push(event.composedPath()));
		target.dispatchEvent(new Event('x', { composed: true, bubbles: true }));
		expect(paths).toEqual([
			[target, innerRoot, innerHost, outerRoot, outerHost, document],
			[innerHost, outerRoot, outerHost, document],
			[outerHost, document],
		]);
	});
});

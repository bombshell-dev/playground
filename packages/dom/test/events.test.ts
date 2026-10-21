import { describe, expect, it, vi } from 'vitest';
import {
	CustomEvent,
	Event,
	EventTarget,
	FocusEvent,
	KeyboardEvent,
	type EventListenerObject,
} from '../src/events.ts';

class TreeTarget extends EventTarget {
	parent: TreeTarget | null = null;

	override getEventParent(): TreeTarget | null {
		return this.parent;
	}
}

function tree(): { root: TreeTarget; parent: TreeTarget; target: TreeTarget } {
	const root = new TreeTarget();
	const parent = new TreeTarget();
	const target = new TreeTarget();
	parent.parent = root;
	target.parent = parent;
	return { root, parent, target };
}

describe('event dispatch', () => {
	it('captures, invokes both target groups, then bubbles with correct state and receiver', () => {
		const { root, parent, target } = tree();
		const calls: string[] = [];
		const event = new Event('Change', { bubbles: true });
		// oxlint-disable-next-line bombshell-dev/max-params -- Test helper mirrors the three asserted callback fields.
		const observe = (name: string, expected: EventTarget, phase: number) =>
			function (this: EventTarget, observed: Event) {
				calls.push(name);
				expect(this).toBe(expected);
				expect(observed).toBe(event);
				expect(observed.target).toBe(target);
				expect(observed.currentTarget).toBe(expected);
				expect(observed.eventPhase).toBe(phase);
				expect(observed.composedPath()).toEqual([target, parent, root]);
			};
		root.addEventListener('Change', observe('root capture', root, Event.CAPTURING_PHASE), true);
		parent.addEventListener('Change', observe('parent capture', parent, Event.CAPTURING_PHASE), {
			capture: true,
		});
		target.addEventListener('Change', observe('target bubble', target, Event.AT_TARGET));
		target.addEventListener('Change', observe('target capture', target, Event.AT_TARGET), true);
		parent.addEventListener('Change', observe('parent bubble', parent, Event.BUBBLING_PHASE));
		root.addEventListener('Change', observe('root bubble', root, Event.BUBBLING_PHASE));
		expect(target.dispatchEvent(event)).toBe(true);
		expect(calls).toEqual([
			'root capture',
			'parent capture',
			'target capture',
			'target bubble',
			'parent bubble',
			'root bubble',
		]);
		expect(event.target).toBe(target);
		expect(event.currentTarget).toBeNull();
		expect(event.eventPhase).toBe(Event.NONE);
		expect(event.composedPath()).toEqual([]);
	});

	it('delivers non-bubbling events to ancestor capture and both target groups', () => {
		const { parent, target } = tree();
		const calls: string[] = [];
		parent.addEventListener('x', () => calls.push('capture'), true);
		parent.addEventListener('x', () => calls.push('bubble'));
		target.addEventListener('x', () => calls.push('target capture'), true);
		target.addEventListener('x', () => calls.push('target bubble'));
		target.dispatchEvent(new Event('x'));
		expect(calls).toEqual(['capture', 'target capture', 'target bubble']);
	});

	it.each(['root', 'parent', 'target'] as const)(
		'checks stopPropagation after %s capture',
		(stopAt) => {
			const nodes = tree();
			const calls: string[] = [];
			for (const name of ['root', 'parent', 'target'] as const) {
				nodes[name].addEventListener(
					'x',
					(event) => {
						calls.push(name);
						if (name === stopAt) event.stopPropagation();
					},
					true,
				);
				nodes[name].addEventListener('x', () => calls.push(`${name} second`), true);
				nodes[name].addEventListener('x', () => calls.push(`${name} bubble`));
			}
			nodes.target.dispatchEvent(new Event('x', { bubbles: true }));
			const names = ['root', 'parent', 'target'];
			expect(calls).toEqual(
				names.slice(0, names.indexOf(stopAt) + 1).flatMap((name) => [name, `${name} second`]),
			);
		},
	);

	it.each(['target', 'parent'] as const)(
		'finishes the current %s bubble invocation when stopped',
		(stopAt) => {
			const nodes = tree();
			const calls: string[] = [];
			for (const name of ['target', 'parent', 'root'] as const) {
				nodes[name].addEventListener('x', (event) => {
					calls.push(name);
					if (name === stopAt) event.stopPropagation();
				});
				nodes[name].addEventListener('x', () => calls.push(`${name} second`));
			}
			nodes.target.dispatchEvent(new Event('x', { bubbles: true }));
			expect(calls).toEqual(
				stopAt === 'target'
					? ['target', 'target second']
					: ['target', 'target second', 'parent', 'parent second'],
			);
		},
	);

	it('stops immediate delivery and clears both stop flags before later reuse', () => {
		const { parent, target } = tree();
		const later = vi.fn();
		const stop = (event: Event): void => event.stopImmediatePropagation();
		target.addEventListener('x', stop);
		target.addEventListener('x', later);
		parent.addEventListener('x', later);
		const event = new Event('x', { bubbles: true });
		target.dispatchEvent(event);
		expect(later).not.toHaveBeenCalled();
		expect(event.cancelBubble).toBe(false);
		target.removeEventListener('x', stop);
		target.dispatchEvent(event);
		expect(later).toHaveBeenCalledTimes(2);
	});

	it('honors a stop flag set before dispatch then clears it', () => {
		const target = new EventTarget();
		const listener = vi.fn();
		const event = new Event('x');
		target.addEventListener('x', listener);
		event.stopPropagation();
		target.dispatchEvent(event);
		expect(listener).not.toHaveBeenCalled();
		target.dispatchEvent(event);
		expect(listener).toHaveBeenCalledOnce();
	});

	it('does not let cancelBubble=false undo a propagation stop', () => {
		const { parent, target } = tree();
		const listener = vi.fn();
		target.addEventListener('x', (event) => {
			event.cancelBubble = true;
			event.cancelBubble = false;
		});
		parent.addEventListener('x', listener);
		target.dispatchEvent(new Event('x', { bubbles: true }));
		expect(listener).not.toHaveBeenCalled();
	});

	it('cancels only cancelable events and preserves cancellation on reuse', () => {
		const target = new EventTarget();
		const listener = (event: Event): void => event.preventDefault();
		target.addEventListener('x', listener);
		expect(target.dispatchEvent(new Event('x'))).toBe(true);
		const event = new Event('x', { cancelable: true });
		expect(target.dispatchEvent(event)).toBe(false);
		expect(event.defaultPrevented).toBe(true);
		expect(event.returnValue).toBe(false);
		event.returnValue = true;
		target.removeEventListener('x', listener);
		expect(target.dispatchEvent(event)).toBe(false);
	});

	it('keeps its entire path stable after listeners reparent the target', () => {
		const { root, parent, target } = tree();
		const replacement = new TreeTarget();
		const calls: string[] = [];
		root.addEventListener(
			'x',
			() => {
				target.parent = replacement;
			},
			true,
		);
		parent.addEventListener('x', () => calls.push('original'));
		replacement.addEventListener('x', () => calls.push('replacement'));
		target.addEventListener(
			'x',
			(event) => expect(event.composedPath()).toEqual([target, parent, root]),
			{ once: true },
		);
		target.dispatchEvent(new Event('x', { bubbles: true }));
		expect(calls).toEqual(['original']);
		target.dispatchEvent(new Event('x', { bubbles: true }));
		expect(calls).toEqual(['original', 'replacement']);
	});

	it('allows nested events but rejects active-event redispatch on every target', () => {
		const target = new EventTarget();
		const other = new EventTarget();
		const outer = new Event('outer');
		const inner = new Event('inner');
		const calls: string[] = [];
		target.addEventListener('outer', (event) => {
			expect(() => target.dispatchEvent(event)).toThrow(
				expect.objectContaining({ name: 'InvalidStateError' }),
			);
			expect(() => other.dispatchEvent(event)).toThrow(
				expect.objectContaining({ name: 'InvalidStateError' }),
			);
			other.dispatchEvent(inner);
			expect(outer.currentTarget).toBe(target);
			expect(inner.currentTarget).toBeNull();
			calls.push('outer');
		});
		other.addEventListener('inner', () => calls.push('inner'));
		target.dispatchEvent(outer);
		target.dispatchEvent(outer);
		expect(calls).toEqual(['inner', 'outer', 'inner', 'outer']);
	});

	it('reports listener exceptions, continues invocation, and cleans transient state', () => {
		const errors = vi.fn();
		const target = new EventTarget({ reportError: errors });
		const failure = new Error('listener failed');
		const later = vi.fn();
		target.addEventListener('x', () => {
			throw failure;
		});
		target.addEventListener('x', later);
		const event = new Event('x');
		expect(target.dispatchEvent(event)).toBe(true);
		expect(errors).toHaveBeenCalledWith(failure);
		expect(later).toHaveBeenCalledOnce();
		expect(event.currentTarget).toBeNull();
		expect(event.eventPhase).toBe(Event.NONE);
	});
});

describe('event listeners', () => {
	it('deduplicates by type, callback and capture; removal is capture-specific', () => {
		const target = new EventTarget();
		const listener = vi.fn();
		target.addEventListener('Change', listener);
		target.addEventListener('Change', listener, { once: true });
		target.addEventListener('Change', listener, true);
		target.removeEventListener('Change', listener, { capture: true });
		target.dispatchEvent(new Event('Change'));
		target.dispatchEvent(new Event('Change'));
		target.dispatchEvent(new Event('change'));
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it('removal takes effect immediately and remove/re-add cannot revive an old registration', () => {
		const target = new EventTarget();
		const calls: string[] = [];
		const later = (): number => calls.push('later');
		const first = (): void => {
			calls.push('first');
			target.removeEventListener('x', later);
			target.addEventListener('x', later);
		};
		target.addEventListener('x', first, { once: true });
		target.addEventListener('x', later);
		target.dispatchEvent(new Event('x'));
		expect(calls).toEqual(['first']);
		target.dispatchEvent(new Event('x'));
		expect(calls).toEqual(['first', 'later']);
	});

	it('takes a fresh listener snapshot for each phase and each ancestor invocation', () => {
		const { parent, target } = tree();
		const calls: string[] = [];
		const sameInvocation = (): number => calls.push('same invocation');
		target.addEventListener(
			'x',
			() => {
				calls.push('target capture');
				target.addEventListener('x', () => {
					calls.push('target bubble');
					target.addEventListener('x', sameInvocation);
					parent.addEventListener('x', () => calls.push('parent bubble'));
				});
			},
			true,
		);
		target.dispatchEvent(new Event('x', { bubbles: true }));
		expect(calls).toEqual(['target capture', 'target bubble', 'parent bubble']);
	});

	it('removes once listeners before invoking them, including nested dispatch', () => {
		const target = new EventTarget();
		const listener = vi.fn(() => target.dispatchEvent(new Event('x')));
		target.addEventListener('x', listener, { once: true });
		target.dispatchEvent(new Event('x'));
		expect(listener).toHaveBeenCalledOnce();
	});

	it('passive listeners cannot cancel and the flag is reset before the next listener', () => {
		const target = new EventTarget();
		const prevented: boolean[] = [];
		target.addEventListener(
			'x',
			(event) => {
				event.preventDefault();
				event.returnValue = false;
				prevented.push(event.defaultPrevented);
			},
			{ passive: true },
		);
		target.addEventListener('x', (event) => {
			event.preventDefault();
			prevented.push(event.defaultPrevented);
		});
		expect(target.dispatchEvent(new Event('x', { cancelable: true }))).toBe(false);
		expect(prevented).toEqual([false, true]);
	});

	it('supports abort before registration and during listener delivery', () => {
		const target = new EventTarget();
		const alreadyAborted = new AbortController();
		alreadyAborted.abort();
		const pending = new AbortController();
		const listener = vi.fn();
		target.addEventListener('x', listener, { signal: alreadyAborted.signal });
		target.addEventListener('x', () => pending.abort());
		target.addEventListener('x', listener, { signal: pending.signal });
		target.dispatchEvent(new Event('x'));
		expect(listener).not.toHaveBeenCalled();
	});

	it('an abort on a duplicate registration does not remove the existing listener', () => {
		const target = new EventTarget();
		const controller = new AbortController();
		const listener = vi.fn();
		target.addEventListener('x', listener);
		target.addEventListener('x', listener, { signal: controller.signal });
		controller.abort();
		target.dispatchEvent(new Event('x'));
		expect(listener).toHaveBeenCalledOnce();
	});

	it('abort removal cannot be canceled by stopping the source signal abort event', () => {
		const target = new EventTarget();
		const controller = new AbortController();
		controller.signal.addEventListener('abort', (event) => event.stopImmediatePropagation());
		const listener = vi.fn();
		target.addEventListener('x', listener, { signal: controller.signal });
		controller.abort();
		target.dispatchEvent(new Event('x'));
		expect(listener).not.toHaveBeenCalled();
		target.addEventListener('x', listener);
		target.dispatchEvent(new Event('x'));
		expect(listener).toHaveBeenCalledOnce();
	});

	it('removes signal listeners before a source abort listener dispatches or re-registers', () => {
		const target = new EventTarget();
		const controller = new AbortController();
		const listener = vi.fn();
		controller.signal.addEventListener('abort', () => {
			target.dispatchEvent(new Event('x'));
			expect(listener).not.toHaveBeenCalled();
			target.addEventListener('x', listener);
		});
		target.addEventListener('x', listener, { signal: controller.signal });
		controller.abort();
		target.dispatchEvent(new Event('x'));
		expect(listener).toHaveBeenCalledOnce();
	});

	it('invokes listener objects with the object receiver and reads handleEvent at invocation', () => {
		const target = new EventTarget();
		let receiver: unknown;
		const old = vi.fn();
		const object: EventListenerObject = { handleEvent: old };
		target.addEventListener('x', object);
		object.handleEvent = function () {
			// oxlint-disable-next-line typescript/no-this-alias -- Capture the actual callback receiver for this assertion.
			receiver = this;
		};
		target.dispatchEvent(new Event('x'));
		expect(receiver).toBe(object);
		expect(old).not.toHaveBeenCalled();
		target.removeEventListener('x', object);
		receiver = null;
		target.dispatchEvent(new Event('x'));
		expect(receiver).toBeNull();
	});

	it('ignores null callbacks', () => {
		const target = new EventTarget();
		target.addEventListener('x', null);
		target.removeEventListener('x', null);
		expect(target.dispatchEvent(new Event('x'))).toBe(true);
	});
});

describe('event data', () => {
	it('preserves event-name case and permits framework bookkeeping', () => {
		const event = Object.assign(new Event('ValueChange'), { _dispatched: 42 });
		expect(event.type).toBe('ValueChange');
		expect(event._dispatched).toBe(42);
		expect(event.isTrusted).toBe(false);
		expect(event.timeStamp).toBeGreaterThanOrEqual(0);
	});

	it('retains typed custom detail and initializes absent detail to null', () => {
		const detail = { value: 1 };
		expect(new CustomEvent('x', { detail }).detail).toBe(detail);
		expect(new CustomEvent('x').detail).toBeNull();
	});

	it('retains focus relatedTarget and exposes initialized keyboard data', () => {
		const target = new EventTarget();
		expect(new FocusEvent('focus', { relatedTarget: target }).relatedTarget).toBe(target);
		const event = new KeyboardEvent('keydown', {
			key: 'A',
			code: 'KeyA',
			shiftKey: true,
			repeat: true,
		});
		expect(event.key).toBe('A');
		expect(event.code).toBe('KeyA');
		expect(event.repeat).toBe(true);
		expect(event.getModifierState('Shift')).toBe(true);
		expect(event.getModifierState('Control')).toBe(false);
		expect(event.getModifierState('unknown')).toBe(false);
	});
});

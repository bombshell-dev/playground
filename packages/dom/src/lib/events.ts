// oxlint-disable bombshell-dev/no-generic-error
// oxlint-disable max-params

// The EventTarget experiment: can native EventTarget manage capture/bubble
// propagation over a parent-linked tree, without reimplementing the DOM?
//
// Native EventTarget provides listener storage, error isolation, and the Event
// flag machinery (stopPropagation, stopImmediatePropagation, preventDefault).
// What it lacks is a tree — dispatchEvent invokes every listener on a single
// target as if AT_TARGET. PropagationTarget adds the tree walk, which needs
// exactly two shims:
//
// 1. Identity. Each per-node native dispatch resets `event.target` to that
//    node, so the real target, phase, and path are pinned as own properties on
//    the event instance, shadowing the prototype getters. `currentTarget`
//    needs no shim — native dispatch sets it correctly per node.
//
// 2. Phase filtering. A bare EventTarget fires `{capture: true}` listeners on
//    every dispatch, so listeners are registered through a thin wrapper that
//    consults the pinned phase. The wrapper also owns `once` and `signal`,
//    because native `once` would consume a listener whose phase never matched.
//
// Between per-node dispatches, `event.cancelBubble` (the legacy readable alias
// for the stop-propagation flag) tells the walk when to halt.

type Listener = EventListener | EventListenerObject;

// Wrappers keyed by capture flag, per (type, callback) — mirroring the DOM's
// (type, callback, capture) listener identity for dedupe and removal.
interface WrapperPair {
	bubble?: EventListener;
	capture?: EventListener;
}

function normalizeOptions(
	options: AddEventListenerOptions | boolean | undefined,
): AddEventListenerOptions {
	return typeof options === 'boolean' ? { capture: options } : (options ?? {});
}

function pin(event: Event, key: string, value: unknown): void {
	Object.defineProperty(event, key, { value, configurable: true });
}

const inFlight = new WeakSet<Event>();

export class PropagationTarget extends EventTarget {
	#listeners = new Map<string, Map<Listener, WrapperPair>>();

	// The DOM spec's "get the parent" hook. Subclasses with a tree override this.
	protected getParentTarget(): PropagationTarget | undefined {
		return undefined;
	}

	override addEventListener(
		type: string,
		callback: Listener | null,
		options?: AddEventListenerOptions | boolean,
	): void {
		if (!callback) {
			return;
		}
		const opts = normalizeOptions(options);
		const capture = opts.capture === true;
		if (opts.signal?.aborted) {
			return;
		}
		let byCallback = this.#listeners.get(type);
		if (!byCallback) {
			byCallback = new Map();
			this.#listeners.set(type, byCallback);
		}
		let pair = byCallback.get(callback);
		if (!pair) {
			pair = {};
			byCallback.set(callback, pair);
		}
		const slot = capture ? 'capture' : 'bubble';
		if (pair[slot]) {
			return;
		}
		const wrapper = (event: Event): void => {
			const phase = event.eventPhase;
			if (phase === Event.CAPTURING_PHASE && !capture) {
				return;
			}
			if (phase === Event.BUBBLING_PHASE && capture) {
				return;
			}
			// `once` is consumed here, after the phase check, so a capture-once
			// listener survives bubble walks that never match it.
			if (opts.once) {
				this.removeEventListener(type, callback, { capture });
			}
			if (typeof callback === 'function') {
				callback.call(this, event);
			} else {
				callback.handleEvent(event);
			}
		};
		pair[slot] = wrapper;
		opts.signal?.addEventListener(
			'abort',
			() => this.removeEventListener(type, callback, { capture }),
			{ once: true },
		);
		super.addEventListener(type, wrapper);
	}

	override removeEventListener(
		type: string,
		callback: Listener | null,
		options?: EventListenerOptions | boolean,
	): void {
		if (!callback) {
			return;
		}
		const capture = normalizeOptions(options).capture === true;
		const byCallback = this.#listeners.get(type);
		const pair = byCallback?.get(callback);
		const slot = capture ? 'capture' : 'bubble';
		const wrapper = pair?.[slot];
		if (!byCallback || !pair || !wrapper) {
			return;
		}
		delete pair[slot];
		if (!pair.bubble && !pair.capture) {
			byCallback.delete(callback);
		}
		if (byCallback.size === 0) {
			this.#listeners.delete(type);
		}
		super.removeEventListener(type, wrapper);
	}

	override dispatchEvent(event: Event): boolean {
		if (inFlight.has(event)) {
			throw new Error('This event is already being dispatched');
		}
		if (event.cancelBubble) {
			// A previous dispatch stopped this event, and native EventTarget offers
			// no way to clear the flag (the DOM resets it on re-dispatch; the legacy
			// cancelBubble setter ignores `false`). Fail loud instead of silently
			// dispatching an event no walk will carry.
			throw new Error('This event was stopped by a previous dispatch; create a fresh event');
		}
		const ancestors: PropagationTarget[] = [];
		for (let t = this.getParentTarget(); t; t = t.getParentTarget()) {
			ancestors.push(t);
		}
		inFlight.add(event);
		pin(event, 'target', this);
		pin(event, 'composedPath', () => [this, ...ancestors]);
		try {
			pin(event, 'eventPhase', Event.CAPTURING_PHASE);
			for (let i = ancestors.length - 1; i >= 0; i--) {
				EventTarget.prototype.dispatchEvent.call(ancestors[i], event);
				if (event.cancelBubble) {
					return !event.defaultPrevented;
				}
			}
			pin(event, 'eventPhase', Event.AT_TARGET);
			EventTarget.prototype.dispatchEvent.call(this, event);
			if (event.bubbles && !event.cancelBubble) {
				pin(event, 'eventPhase', Event.BUBBLING_PHASE);
				for (const ancestor of ancestors) {
					EventTarget.prototype.dispatchEvent.call(ancestor, event);
					if (event.cancelBubble) {
						break;
					}
				}
			}
			return !event.defaultPrevented;
		} finally {
			inFlight.delete(event);
			pin(event, 'eventPhase', Event.NONE);
			pin(event, 'composedPath', () => []);
		}
	}
}

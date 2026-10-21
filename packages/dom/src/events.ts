export interface EventInit {
	bubbles?: boolean;
	cancelable?: boolean;
	composed?: boolean;
}

export type EventPhase = 0 | 1 | 2 | 3;

interface PathEntry {
	invocationTarget: EventTarget;
	target: EventTarget | null;
	relatedTarget: EventTarget | null;
	closedRoots: readonly EventTarget[];
	atTarget: boolean;
}

interface EventState {
	target: EventTarget | null;
	currentTarget: EventTarget | null;
	relatedTarget: EventTarget | null;
	path: PathEntry[];
	phase: EventPhase;
	dispatching: boolean;
	stopped: boolean;
	immediateStopped: boolean;
	passive: boolean;
	canceled: boolean;
}

const states = new WeakMap<Event, EventState>();

function stateOf(event: Event): EventState {
	const state = states.get(event);
	// oxlint-disable-next-line bombshell-dev/no-generic-error -- Web IDL rejects incompatible event objects with TypeError.
	if (!state) throw new TypeError('Expected an @bomb.sh/dom Event');
	return state;
}

/** Synthetic events are extensible, so frameworks can attach their bookkeeping. */
export class Event {
	static readonly NONE = 0;
	static readonly CAPTURING_PHASE = 1;
	static readonly AT_TARGET = 2;
	static readonly BUBBLING_PHASE = 3;
	readonly NONE = 0;
	readonly CAPTURING_PHASE = 1;
	readonly AT_TARGET = 2;
	readonly BUBBLING_PHASE = 3;
	readonly type: string;
	readonly bubbles: boolean;
	readonly cancelable: boolean;
	readonly composed: boolean;
	readonly timeStamp = performance.now();

	constructor(type: string, options: EventInit = {}) {
		this.type = String(type);
		this.bubbles = Boolean(options.bubbles);
		this.cancelable = Boolean(options.cancelable);
		this.composed = Boolean(options.composed);
		states.set(this, {
			target: null,
			currentTarget: null,
			relatedTarget: null,
			path: [],
			phase: Event.NONE,
			dispatching: false,
			stopped: false,
			immediateStopped: false,
			passive: false,
			canceled: false,
		});
	}

	get target(): EventTarget | null {
		return stateOf(this).target;
	}

	get srcElement(): EventTarget | null {
		return this.target;
	}

	get currentTarget(): EventTarget | null {
		return stateOf(this).currentTarget;
	}

	get eventPhase(): EventPhase {
		return stateOf(this).phase;
	}

	get isTrusted(): false {
		return false;
	}

	get defaultPrevented(): boolean {
		return stateOf(this).canceled;
	}

	get cancelBubble(): boolean {
		return stateOf(this).stopped;
	}

	set cancelBubble(value: boolean) {
		if (value) this.stopPropagation();
	}

	get returnValue(): boolean {
		return !this.defaultPrevented;
	}

	set returnValue(value: boolean) {
		if (!value) this.preventDefault();
	}

	composedPath(): EventTarget[] {
		const state = stateOf(this);
		const current = state.path.find((entry) => entry.invocationTarget === state.currentTarget);
		if (!current) return [];
		return state.path
			.filter((entry) => entry.closedRoots.every((root) => current.closedRoots.includes(root)))
			.map((entry) => entry.invocationTarget);
	}

	stopPropagation(): void {
		stateOf(this).stopped = true;
	}

	stopImmediatePropagation(): void {
		const state = stateOf(this);
		state.stopped = true;
		state.immediateStopped = true;
	}

	preventDefault(): void {
		const state = stateOf(this);
		if (this.cancelable && !state.passive) state.canceled = true;
	}
}

export interface CustomEventInit<T> extends EventInit {
	detail?: T;
}

/** An event carrying application-defined detail. */
export class CustomEvent<T = unknown> extends Event {
	readonly detail: T | null;

	constructor(type: string, options: CustomEventInit<T> = {}) {
		super(type, options);
		this.detail = options.detail === undefined ? null : options.detail;
	}
}

export interface FocusEventInit extends EventInit {
	relatedTarget?: EventTarget | null;
}

/** A focus transition event with a retargetable related target. */
export class FocusEvent extends Event {
	constructor(type: string, options: FocusEventInit = {}) {
		super(type, options);
		stateOf(this).relatedTarget = options.relatedTarget ?? null;
	}

	get relatedTarget(): EventTarget | null {
		return stateOf(this).relatedTarget;
	}
}

export interface KeyboardEventInit extends EventInit {
	key?: string;
	code?: string;
	location?: number;
	ctrlKey?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
	metaKey?: boolean;
	repeat?: boolean;
	isComposing?: boolean;
}

/** Synthetic keyboard data without browser default actions. */
export class KeyboardEvent extends Event {
	static readonly DOM_KEY_LOCATION_STANDARD = 0;
	static readonly DOM_KEY_LOCATION_LEFT = 1;
	static readonly DOM_KEY_LOCATION_RIGHT = 2;
	static readonly DOM_KEY_LOCATION_NUMPAD = 3;
	readonly DOM_KEY_LOCATION_STANDARD = 0;
	readonly DOM_KEY_LOCATION_LEFT = 1;
	readonly DOM_KEY_LOCATION_RIGHT = 2;
	readonly DOM_KEY_LOCATION_NUMPAD = 3;
	readonly key: string;
	readonly code: string;
	readonly location: number;
	readonly ctrlKey: boolean;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly metaKey: boolean;
	readonly repeat: boolean;
	readonly isComposing: boolean;

	constructor(type: string, options: KeyboardEventInit = {}) {
		super(type, options);
		this.key = String(options.key ?? '');
		this.code = String(options.code ?? '');
		this.location = Number(options.location ?? 0) >>> 0;
		this.ctrlKey = Boolean(options.ctrlKey);
		this.shiftKey = Boolean(options.shiftKey);
		this.altKey = Boolean(options.altKey);
		this.metaKey = Boolean(options.metaKey);
		this.repeat = Boolean(options.repeat);
		this.isComposing = Boolean(options.isComposing);
	}

	getModifierState(key: string): boolean {
		switch (key) {
			case 'Alt':
				return this.altKey;
			case 'Control':
				return this.ctrlKey;
			case 'Meta':
				return this.metaKey;
			case 'Shift':
				return this.shiftKey;
			default:
				return false;
		}
	}
}

export interface EventListener<Target extends EventTarget = EventTarget> {
	(this: Target, event: Event): void;
}

export interface EventListenerObject {
	handleEvent(event: Event): void;
}

export type EventListenerOrEventListenerObject<Target extends EventTarget = EventTarget> =
	| EventListener<Target>
	| EventListenerObject;

export interface EventListenerOptions {
	capture?: boolean;
}

export interface AddEventListenerOptions extends EventListenerOptions {
	once?: boolean;
	passive?: boolean;
	signal?: AbortSignal;
}

interface Registration {
	type: string;
	callback: object;
	invoke: (event: Event) => void;
	capture: boolean;
	once: boolean;
	passive: boolean;
	removed: boolean;
	signal?: AbortSignal;
	abort?: () => void;
}

export interface EventTargetOptions {
	/** Listener exceptions are reported here without escaping dispatchEvent. */
	reportError?: (error: unknown) => void;
}

function reportUnhandledError(error: unknown): void {
	queueMicrotask(() => {
		throw error;
	});
}

/** Listener registration and capture/target/bubble event dispatch. */
export class EventTarget {
	readonly #listeners: Registration[] = [];
	readonly #reportError: (error: unknown) => void;

	constructor(options: EventTargetOptions = {}) {
		this.#reportError = options.reportError ?? reportUnhandledError;
	}

	// oxlint-disable-next-line bombshell-dev/max-params -- Standard EventTarget signature.
	addEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject<this> | null,
		options: boolean | AddEventListenerOptions = {},
	): void {
		const name = String(type);
		const normalized = typeof options === 'boolean' ? { capture: options } : (options ?? {});
		const capture = Boolean(normalized.capture);
		const once = Boolean(normalized.once);
		const passive = Boolean(normalized.passive);
		const providedSignal = normalized.signal;
		// Dictionary conversion precedes the null-listener and duplicate checks.
		// A private dependent signal follows the source's abort algorithm even
		// when a user listener stops propagation of its public abort event.
		const signal = providedSignal === undefined ? undefined : AbortSignal.any([providedSignal]);
		if (callback == null || signal?.aborted) return;
		if (
			this.#listeners.some(
				(entry) =>
					entry.type === name &&
					entry.callback === callback &&
					entry.capture === capture &&
					!entry.signal?.aborted,
			)
		)
			return;
		const registration: Registration = {
			type: name,
			callback,
			invoke: (event) => {
				if (typeof callback === 'function') callback.call(this, event);
				else callback.handleEvent(event);
			},
			capture,
			once,
			passive,
			removed: false,
			signal,
		};
		if (registration.signal) {
			registration.abort = () => this.#removeRegistration(registration);
			registration.signal.addEventListener('abort', registration.abort, { once: true });
		}
		this.#listeners.push(registration);
	}

	// oxlint-disable-next-line bombshell-dev/max-params -- Standard EventTarget signature.
	removeEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject<this> | null,
		options: boolean | EventListenerOptions = {},
	): void {
		const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
		const name = String(type);
		const registration = this.#listeners.find(
			(entry) => entry.type === name && entry.callback === callback && entry.capture === capture,
		);
		if (registration) this.#removeRegistration(registration);
	}

	dispatchEvent(event: Event): boolean {
		const state = stateOf(event);
		if (state.dispatching)
			throw new DOMException('The event is already being dispatched', 'InvalidStateError');
		state.dispatching = true;
		state.target = this;
		const originalRelatedTarget = state.relatedTarget;
		let clearTargets = false;
		try {
			const visited = new Set<EventTarget>();
			for (
				// oxlint-disable-next-line typescript/no-this-alias -- Mutable cursor for the event ancestor path.
				let current: EventTarget | null = this;
				current;
				current = current.getEventParent(event)
			) {
				if (visited.has(current))
					throw new DOMException('The event parent path contains a cycle', 'HierarchyRequestError');
				visited.add(current);
				const target = current.retargetEventTarget(this);
				const relatedTarget = current.retargetEventTarget(originalRelatedTarget);
				if (target === relatedTarget && originalRelatedTarget !== this) break;
				state.path.push({
					invocationTarget: current,
					target,
					relatedTarget,
					closedRoots: [...current.getEventClosedRoots()],
					atTarget: target === current,
				});
			}
			const terminal = state.path.at(-1);
			clearTargets = Boolean(
				terminal?.target?.isEventTargetInShadowTree() ||
				terminal?.relatedTarget?.isEventTargetInShadowTree(),
			);
			for (const entry of state.path.toReversed()) this.#invoke({ event, entry, capture: true });
			for (const entry of state.path) {
				if (entry.atTarget || event.bubbles) this.#invoke({ event, entry, capture: false });
			}
			return !state.canceled;
		} finally {
			state.phase = Event.NONE;
			state.currentTarget = null;
			state.path = [];
			state.dispatching = false;
			state.stopped = false;
			state.immediateStopped = false;
			state.passive = false;
			if (clearTargets) {
				state.target = null;
				state.relatedTarget = null;
			}
		}
	}

	/** Tree subclasses supply their event parent; plain targets have no parent. */
	protected getEventParent(_event: Event): EventTarget | null {
		return null;
	}

	/** Retarget against this invocation target before any listeners run. */
	protected retargetEventTarget(target: EventTarget | null): EventTarget | null {
		return target;
	}

	/** Closed shadow roots containing this target, captured with the event path. */
	protected getEventClosedRoots(): readonly EventTarget[] {
		return [];
	}

	/** Used to clear target references after dispatch confined to a shadow tree. */
	protected isEventTargetInShadowTree(): boolean {
		return false;
	}

	protected reportEventError(error: unknown): void {
		this.#reportError(error);
	}

	#removeRegistration(registration: Registration): void {
		registration.removed = true;
		const index = this.#listeners.indexOf(registration);
		if (index !== -1) this.#listeners.splice(index, 1);
		if (registration.signal && registration.abort) {
			registration.signal.removeEventListener('abort', registration.abort);
		}
	}

	#invoke(options: { event: Event; entry: PathEntry; capture: boolean }): void {
		const { event, entry, capture } = options;
		const state = stateOf(event);
		state.target = entry.target;
		state.relatedTarget = entry.relatedTarget;
		state.phase = entry.atTarget
			? Event.AT_TARGET
			: capture
				? Event.CAPTURING_PHASE
				: Event.BUBBLING_PHASE;
		if (state.stopped) return;
		const target = entry.invocationTarget;
		state.currentTarget = target;
		// oxlint-disable-next-line unicorn/no-useless-spread -- DOM requires a snapshot per invocation.
		for (const registration of [...target.#listeners]) {
			// Native dependent signals become aborted before the source's public
			// abort listeners run, even if our removal callback has not run yet.
			if (registration.signal?.aborted) {
				target.#removeRegistration(registration);
				continue;
			}
			if (
				registration.removed ||
				registration.type !== event.type ||
				registration.capture !== capture
			)
				continue;
			if (registration.once) target.#removeRegistration(registration);
			state.passive = registration.passive;
			try {
				registration.invoke(event);
			} catch (error) {
				try {
					target.reportEventError(error);
				} catch (reportingError) {
					reportUnhandledError(reportingError);
				}
			} finally {
				state.passive = false;
			}
			if (state.immediateStopped) break;
		}
	}
}

/* oxlint-disable bombshell-dev/max-params -- These callbacks match framework host property signatures. */
/* oxlint-disable bombshell-dev/exported-function-async -- Framework property mutation must complete in the caller’s synchronous update. */
/* oxlint-disable bombshell-dev/no-generic-error -- Unsupported prop values fail with TypeError at the adapter boundary. */
import type { Element } from '@bomb.sh/dom';
import type { Event } from '@bomb.sh/dom';

const handlers = new WeakMap<Element, Map<string, (event: Event) => void>>();

/** Translate framework prop spelling at the adapter boundary, never in the DOM. */
export function setHostProperty(element: Element, name: string, value: unknown): void {
	if (name === 'children' || name === 'ref' || name === 'key') return;
	if (name.startsWith('on')) {
		let eventName = name.startsWith('on:') ? name.slice(3) : name.slice(2);
		const capture = !name.startsWith('on:') && eventName.endsWith('Capture');
		if (capture) eventName = eventName.slice(0, -7);
		if (!name.startsWith('on:') && /^[A-Z]/.test(eventName)) eventName = eventName.toLowerCase();
		let registered = handlers.get(element);
		const previous = registered?.get(name);
		if (previous) element.removeEventListener(eventName, previous, capture);
		registered?.delete(name);
		if (typeof value === 'function') {
			if (!registered) handlers.set(element, (registered = new Map()));
			const listener = (event: Event): void => {
				value.call(element, event);
			};
			registered.set(name, listener);
			element.addEventListener(eventName, listener, capture);
		}
		return;
	}
	if (name === 'style' || name === 'dangerouslySetInnerHTML') {
		throw new TypeError(`${name} is not supported by this framework adapter`);
	}
	if (name === 'className') name = 'class';
	if (name === 'value' && 'value' in element) {
		Reflect.set(element, 'value', value ?? '');
		return;
	}
	if (
		value === null ||
		value === undefined ||
		(value === false && !name.startsWith('data-') && !name.startsWith('aria-'))
	)
		element.removeAttribute(name);
	else element.setAttribute(name, value === true ? '' : String(value));
}

/** Apply removed and changed framework props to a native element. */
export function updateHostProperties(
	element: Element,
	previous: Readonly<Record<string, unknown>>,
	next: Readonly<Record<string, unknown>>,
): void {
	for (const name of Object.keys(previous))
		if (!(name in next)) setHostProperty(element, name, undefined);
	for (const [name, value] of Object.entries(next)) {
		if (previous[name] !== value) setHostProperty(element, name, value);
	}
}

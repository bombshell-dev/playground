import { open, close, text, rgba } from '@bomb.sh/tty';
import { id } from '../core.ts';
import { emit } from '../emit.ts';
import { getElement, type HostElement } from '../elements.ts';
import { type Host, HostApi } from '../host.ts';
import { LayoutApi } from '../layout.ts';
import { getFocus, setFocusable } from '../focus.ts';
import { KeyboardApi } from '../keyboard.ts';
import type { KeyDown, KeyRepeat } from '@bomb.sh/tty';

export interface ButtonPressEvent {
	type: 'press';
	target: HostElement;
}

declare module '@clack/ui/events' {
	interface HostEvents {
		press: ButtonPressEvent;
	}
}

declare module '@clack/ui/elements' {
	interface HostElements {
		button: Record<string, unknown>;
	}
}

function nearestForm(element: HostElement): HostElement | undefined {
	for (let current: HostElement | undefined = element; current; current = current.parent) {
		if (current.name === 'form') return current;
	}
	return undefined;
}

function collectValues(form: HostElement): Record<string, string> {
	const values: Record<string, string> = {};
	function visit(element: HostElement): void {
		for (const child of element.children) {
			if (child.type !== 'element') continue;
			if (child.name === 'input') {
				const key =
					typeof child.properties.label === 'string'
						? child.properties.label
						: String(child.properties.key ?? 'field');
				values[key] = String(child.properties.value ?? '');
			}
			visit(child);
		}
	}
	visit(form);
	return values;
}

/**
 * A button is a focusable inline control that paints its label and fires
 * `press` when activated with Enter or Space. A button with `type: 'submit'`
 * inside a form also emits `submit` on the enclosing form with the collected
 * field values — the DOM implicit-submission contract, terminal edition.
 */
export function useButtonElement(host: Host): void {
	HostApi.around(host.root, {
		createElement([_node, name], next) {
			const element = next(_node, name);
			if (element.name === 'button') {
				element.attach = (node) => {
					setFocusable(node);
				};
			}
			return element;
		},
	});

	LayoutApi.around(host.root, {
		*layout([node], next) {
			const element = getElement(node);
			if (element.name === 'button') {
				const focused = node === getFocus(node);
				const properties = { ...element.properties };
				properties.color = focused ? rgba(255, 255, 255) : rgba(100, 100, 100);
				yield open(id(node), properties);
				let content = '';
				for (const child of element.children) {
					if (child.type === 'literal') content += child.content;
				}
				yield text(content || ' ');
				yield close();
			} else {
				return yield* next(node);
			}
		},
	});

	KeyboardApi.around(host.root, {
		keydown([node, event], next) {
			activateIfButton(node, event as KeyDown);
			return next(node, event);
		},
		keyrepeat([node, event], next) {
			activateIfButton(node, event as KeyRepeat);
			return next(node, event);
		},
	});

	function activateIfButton(node: object, event: KeyDown | KeyRepeat): void {
		if (event.type !== 'keydown') return;
		if (event.code !== 'Enter' && event.code !== 'Space') return;
		const element = getElement(node);
		if (element.name !== 'button' || node !== getFocus(node)) return;
		emit(node, { type: 'press' });
		if (element.properties.type === 'submit') {
			const form = nearestForm(element);
			if (form) emit(form.node!, { type: 'submit', values: collectValues(form) });
		}
	}
}

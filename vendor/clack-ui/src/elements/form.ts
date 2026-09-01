import { id } from '../core.ts';
import { KeyboardApi } from '../keyboard.ts';
import { LayoutApi } from '../layout.ts';
import { emit } from '../emit.ts';
import { getElement, type HostElement } from '../elements.ts';
import { type Host } from '../host.ts';
import { containerLayout } from './box.ts';

export interface FormSubmitEvent {
	type: 'submit';
	/** Field values collected from descendant inputs, keyed by label (or node id). */
	values: Record<string, string>;
	target: HostElement;
}

declare module '@clack/ui/events' {
	interface HostEvents {
		submit: FormSubmitEvent;
	}
}

declare module '@clack/ui/elements' {
	interface HostElements {
		form: Record<string, unknown>;
	}
}

export function nearestForm(element: HostElement): HostElement | undefined {
	for (let current: HostElement | undefined = element; current; current = current.parent) {
		if (current.name === 'form') return current;
	}
	return undefined;
}

/** Field values from descendant inputs, keyed by label (falling back to node id). */
export function collectValues(form: HostElement): Record<string, string> {
	const values: Record<string, string> = {};
	function visit(element: HostElement): void {
		for (const child of element.children) {
			if (child.type !== 'element') continue;
			if (child.name === 'input') {
				const key = typeof child.properties.label === 'string'
					? child.properties.label
					: String(child.properties.key ?? id(child.node!));
				values[key] = String(child.properties.value ?? '');
			}
			visit(child);
		}
	}
	visit(form);
	return values;
}

/**
 * A form is a container (box layout) that owns implicit submission: pressing
 * Enter inside any of its fields emits a `submit` event on the form with the
 * collected field values. Enter is consumed at the form boundary and never
 * reaches elements mounted outside it.
 */
export function useFormElement(host: Host): void {
	LayoutApi.around(host.root, {
		*layout([node], next) {
			const element = getElement(node);
			if (element.name === 'form') {
				yield* containerLayout(node, element);
			} else {
				return yield* next(node);
			}
		},
	});

	KeyboardApi.around(host.root, {
		keydown([node, event], next) {
			if (event.code !== 'Enter') return next(node, event);
			const form = nearestForm(getElement(node));
			if (!form) return next(node, event);
			emit(form.node!, { type: 'submit', values: collectValues(form) });
		},
	});
}

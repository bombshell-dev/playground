// oxlint-disable no-unused-vars
import { createApi, type Node } from './core.ts';
import { getElement, type HostElement } from './elements.ts';
import type { AnyHostEvent, HostEvent, HostEvents } from './events.ts';

export const EmitApi = createApi('emit', {
	emit(node, event: AnyHostEvent): void {
		if (event.target !== getElement(node)) {
			throw new InvalidEventTargetError(node, event.target);
		}
	},
});

export function emit<E extends Omit<AnyHostEvent, 'target'>>(node: Node, data: E): void {
	return EmitApi.methods.emit(node, {
		...data,
		target: getElement(node),
	} as AnyHostEvent);
}

class InvalidEventTargetError extends TypeError {
	readonly code = 'CLACK_UI_INVALID_EVENT_TARGET';
	readonly node: Node;
	readonly target: HostElement;

	constructor(node: Node, target: HostElement) {
		super('event target does not match emitting node');
		this.name = 'InvalidEventTargetError';
		this.node = node;
		this.target = target;
	}
}

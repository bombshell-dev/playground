import { createApi, type Node } from './core.ts';
import { getElement, type HostElement } from './elements.ts';
import type { AnyHostEvent, HostEventType, HostEvents } from './events.ts';

export const EmitApi = createApi('emit', {
	emit(node, event: AnyHostEvent): void {
		if (event.target !== getElement(node)) {
			throw new InvalidEventTargetError(node, event.target);
		}
	},
});

type EventData = { [T in HostEventType]: Omit<HostEvents[T], 'target'> }[HostEventType];

export function emit(node: Node, data: EventData): void {
	return EmitApi.methods.emit(node, {
		...data,
		target: getElement(node),
	});
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

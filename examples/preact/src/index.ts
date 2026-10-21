/* oxlint-disable bombshell-dev/exported-function-async -- Framework mounting and host factories are synchronous by contract. */
// Adapted from @clack/ui-preact at 606675f16131c6ae7c4553a67ab477bdf661f772.
// Copyright (c) 2025-Present Bombshell contributors. MIT license; see LICENSE.
import { render, type ComponentChild, type ComponentChildren, type Key, type Ref } from 'preact';
import type { Element } from '@bomb.sh/dom';
import type { Event } from '@bomb.sh/dom';

export interface Root extends Disposable {
	readonly element: Element;
	render(node: ComponentChild): void;
	unmount(): void;
}

/** Mount into an existing element. Its ownerDocument determines every created node. */
export function createRoot(element: Element): Root {
	return {
		element,
		render(node) {
			render(node, element);
		},
		unmount() {
			render(null, element);
		},
		[Symbol.dispose]() {
			this.unmount();
		},
	};
}

export type AttributeValue = string | number | boolean | null | undefined;
export type EventHandler = (event: Event) => void;

/** Host props describe this DOM, without claiming browser rendering APIs. */
export interface ElementProps {
	children?: ComponentChildren;
	key?: Key;
	ref?: Ref<Element>;
	id?: string;
	class?: string;
	title?: string;
	tabIndex?: number;
	[attribute: `data-${string}`]: AttributeValue;
	[attribute: `aria-${string}`]: AttributeValue;
	[event: `on${string}`]: EventHandler | undefined;
	style?: never;
}

export interface HostElements {
	[tagName: string]: ElementProps;
}

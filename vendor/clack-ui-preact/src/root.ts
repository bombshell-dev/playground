// oxlint-disable bombshell-dev/exported-function-async -- Preact root creation is synchronous.
import { HostApi, type Host } from '@clack/ui';
import type { HostElement } from '@clack/ui/elements';
import { type ComponentChild, render } from 'preact';
import { createContainer } from './facade.ts';

export interface Root {
	readonly element: HostElement;
	readonly host: Host;
	/** Reconcile `node` into the Host synchronously. */
	render(node: ComponentChild): void;
	/** Remove the Preact tree from the Host synchronously. */
	unmount(): void;
}

/** Create a Preact root which reconciles into an attached Host element. */
export function createRoot(element: HostElement): Root {
	const host = HostApi.methods.getHost(element.node!);
	const container = createContainer(host, element);

	return {
		element,
		host,
		render(node) {
			render(node, container);
		},
		unmount() {
			render(null, container);
		},
	};
}

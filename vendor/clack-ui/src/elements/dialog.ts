import { LayoutApi } from '../layout.ts';
import { getElement, type HostElement, type HostElementChild } from '../elements.ts';
import { type Host, HostApi } from '../host.ts';
import { activateFocusScope } from '../focus.ts';
import { containerLayout, type BoxProps } from './box.ts';

export interface DialogProps extends BoxProps {
	role?: string;
	label?: string;
	modal?: boolean;
}

declare module '@clack/ui/elements' {
	interface HostElements {
		dialog: DialogProps;
	}
}

/**
 * A dialog is a container. A dialog attached with `modal: true` owns the active
 * focus scope until its subtree is removed. The focus API chooses its first
 * focusable descendant and restores the prior focus when the dialog closes.
 */
export function useDialogElement(host: Host): void {
	LayoutApi.around(host.root, {
		*layout([node], next) {
			const element = getElement(node);
			if (element.name === 'dialog') {
				yield* containerLayout(node, element);
			} else {
				return yield* next(node);
			}
		},
	});

	HostApi.around(host.root, {
		insertBefore([node, parent, child, anchor], next) {
			const wasAttached = child.type === 'element' && child.node !== null;
			next(node, parent, child, anchor);
			if (child.type !== 'element' || wasAttached || child.node === null) return;
			for (const dialog of modalDialogs(child)) activateFocusScope(dialog.node!);
		},
	});
}

function* modalDialogs(child: HostElementChild): Iterable<HostElement> {
	if (child.type !== 'element') return;
	if (child.name === 'dialog' && child.properties.modal === true) yield child;
	for (const descendant of child.children) yield* modalDialogs(descendant);
}

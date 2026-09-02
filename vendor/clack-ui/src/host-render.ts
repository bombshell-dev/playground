import { requestRender } from './render.ts';
import { type Host, HostApi } from './host.ts';
import { FocusApi, getFocus } from './focus.ts';

export function useHostRenderer(host: Host): void {
	HostApi.around(host.root, {
		insertBefore([node, parent, child, anchor], next) {
			const originalParentNode = child.parent?.node ?? null;

			next(node, parent, child, anchor);

			if (originalParentNode) {
				requestRender(originalParentNode);
			}

			if (parent.node && parent.node !== originalParentNode) {
				requestRender(parent.node);
			}
		},
		removeChild([root, parent, child], next) {
			next(root, parent, child);

			if (parent.node) {
				requestRender(parent.node);
			}
		},
		setProperty([root, element, name, value], next) {
			next(root, element, name, value);

			if (element.node) {
				requestRender(element.node);
			}
		},
		setText([root, text, content], next) {
			next(root, text, content);

			if (text.parent && text.parent.node) {
				requestRender(text.parent.node);
			}
		},
	});

	FocusApi.around(host.root, {
		setFocus([node], next) {
			const original = getFocus(node);
			next(node);
			if (original !== node) {
				requestRender(node);
			}
		},
	});
}

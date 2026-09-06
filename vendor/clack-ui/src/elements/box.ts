import { open, close, text, type OpenElement, type Op } from '@bomb.sh/tty';
import { id, type Node } from '../core.ts';
import { type Host } from '../host.ts';
import { LayoutApi, layout } from '../layout.ts';
import { getElement, type HostElement } from '../elements.ts';

export type BoxProps = Omit<OpenElement, 'directive' | 'id'>;

declare module '@clack/ui/elements' {
	interface HostElements {
		box: BoxProps;
	}
}

export function useBoxElement(host: Host): void {
	LayoutApi.around(host.root, {
		*layout([node], next) {
			const element = getElement(node);
			if (element.name === 'box') {
				yield* containerLayout(node, element);
			} else {
				return yield* next(node);
			}
		},
	});
}

/** Container layout: box framing with literal children folded into text runs. */
export function* containerLayout(node: Node, element: HostElement): Generator<Op> {
	let content = '';
	yield open(id(node), element.properties);
	for (const child of element.children) {
		if (child.type === 'element') {
			if (content !== '') {
				yield text(content);
				content = '';
			}
			yield* layout(child.node!);
		} else {
			content += child.content;
		}
	}
	if (content !== '') {
		yield text(content);
	}
	yield close();
}

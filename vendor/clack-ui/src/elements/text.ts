import { text, type Text } from '@bomb.sh/tty';
import { type Host } from '../host.ts';
import { getElement } from '../elements.ts';
import { LayoutApi } from '../layout.ts';

export type TextProps = Omit<Text, 'directive' | 'content'>;

declare module '@clack/ui/elements' {
	interface HostElements {
		text: TextProps;
	}
}

/**
 * Install "text" element behavior into a host.
 *
 * Text elements ignore non-textual children like "box" or "input" and will
 * always return an iteration of tty `text()` directives
 */
export function useTextElement(host: Host) {
	LayoutApi.around(host.root, {
		*layout([node], next) {
			const element = getElement(node);
			if (element.name === 'text') {
				let content = '';
				for (const child of element.children) {
					if (child.type === 'literal') {
						content += child.content;
					}
				}
				yield text(content, element.properties);
			} else {
				return yield* next(node);
			}
		},
	});
}

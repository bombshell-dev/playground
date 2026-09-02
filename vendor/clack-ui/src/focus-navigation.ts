import { advanceFocus, retreatFocus } from './focus.ts';
import type { Host } from './host.ts';
import { KeyboardApi } from './keyboard.ts';

export function useFocusNavigation(host: Host): void {
	KeyboardApi.around(host.root, {
		keydown([node, event], next) {
			if (event.code === 'Tab') {
				advanceFocus(node);
			} else if (event.code === 'Backtab') {
				retreatFocus(node);
			} else {
				next(node, event);
			}
		},
		keyrepeat([node, event], next) {
			if (event.code === 'Tab') {
				advanceFocus(node);
			} else if (event.code === 'Backtab') {
				retreatFocus(node);
			} else {
				next(node, event);
			}
		},
	});
}

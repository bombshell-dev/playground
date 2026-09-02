// oxlint-disable no-unused-vars
import type { KeyDown, KeyEvent, KeyRepeat, KeyUp } from '@bomb.sh/tty';
import { createApi } from './core.ts';
import type { Host } from './host.ts';
import { DispatchApi } from './dispatch.ts';
import { getFocus } from './focus.ts';

export function useKeyboard(host: Host): void {
	DispatchApi.around(host.root, {
		dispatch([node, event], next) {
			if (isKeyEvent(event)) {
				const focus = getFocus(node);
				KeyboardApi.invoke(event.type, [focus, event as KeyDown & KeyUp & KeyRepeat]);
				return { ok: true };
			} else {
				return next(node, event);
			}
		},
	});
}

export const KeyboardApi = createApi('keyboard', {
	keydown(node, event: KeyDown): void {},
	keyup(node, event: KeyUp): void {},
	keyrepeat(node, event: KeyRepeat): void {},
});

function isKeyEvent(value: unknown): value is KeyEvent {
	const x = value as KeyEvent;

	return (
		!!x &&
		typeof x.key === 'string' &&
		typeof x.code === 'string' &&
		['keyup', 'keydown', 'keyrepeat'].includes(x.type)
	);
}

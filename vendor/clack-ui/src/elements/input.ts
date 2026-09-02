import { createApi, createContext, id, type Node } from '../core.ts';
import { open, close, text, fit, percent, rgba, type KeyDown, type KeyRepeat } from '@bomb.sh/tty';
import type { HostEvent } from '@clack/ui/events';
import { emit } from '../emit.ts';
import { getElement } from '../elements.ts';
import { type Host, HostApi } from '../host.ts';
import { LayoutApi } from '../layout.ts';
import { getFocus, setFocusable } from '../focus.ts';
import { requestRender } from '../render.ts';
import { KeyboardApi } from '../keyboard.ts';

export interface InputEvent extends HostEvent<'input'> {
	value: string;
}

declare module '@clack/ui/events' {
	interface HostEvents {
		input: InputEvent;
	}
}

export interface InputProps {
	role?: string;
	label?: string;
	oninput?: (event: InputEvent) => void;
}

declare module '@clack/ui/elements' {
	interface HostElements {
		input: InputProps;
	}
}

export function useInputElement(host: Host): void {
	const { root } = host;

	HostApi.around(root, {
		createElement([root, name], next) {
			const element = next(root, name);
			if (element.name === 'input') {
				const model = { content: '', caret: 0 };
				element.attach = (node) => {
					setFocusable(node);
					InputContext.set(node, model);
				};

				// make value and caret accessible to the public <input/>
				Object.defineProperties(element.properties, {
					value: {
						get() {
							return model.content;
						},
					},
					caret: {
						get() {
							return model.caret;
						},
					},
				});
			}
			return element;
		},
	});

	LayoutApi.around(root, {
		*layout([node], next) {
			const element = getElement(node);
			if (element.name !== 'input') {
				return yield* next(node);
			}

			const focused = node === getFocus(node);
			const model = InputContext.expect(node);
			const value = model.content;
			const caret = Math.min(model.caret, [...value].length);
			const color = focused ? rgba(255, 255, 255) : rgba(100, 100, 100);
			const border = { color, top: 1, right: 1, bottom: 1, left: 1 };
			yield open(id(node), {
				border,
				layout: {
					height: fit(3),
					width: percent(0.3),
					padding: { top: 1, right: 1, bottom: 1, left: 1 },
				},
			});
			yield text(value, { color, ...(focused ? { caret } : {}) });
			yield close();
		},
	});

	KeyboardApi.around(root, {
		keydown([node, event], next) {
			if (!handleKeyEvent(node, event)) {
				return next(node, event);
			}
		},
		keyrepeat([node, event], next) {
			if (!handleKeyEvent(node, event)) {
				return next(node, event);
			}
		},
	});
}

export const InputApi = createApi('input', {
	insert(node, text: string): void {
		withModel(node, (model) => {
			// Inputs are single-line, so discard CR/LF. Spreading the string produces
			// Unicode code points rather than UTF-16 code units.
			const inserted = [...text.replace(/[\r\n]/g, '')];
			const codepoints = [...model.content];
			const caret = model.caret;

			// The caret is a code-point index. Insert each new code point independently,
			// then advance by exactly the number that survived normalization.
			codepoints.splice(caret, 0, ...inserted);
			model.content = codepoints.join('');
			model.caret = caret + inserted.length;
		});
	},
	deleteBackward(node): void {
		withModel(node, (model) => {
			const codepoints = [...model.content];
			let caret = model.caret;
			const length = codepoints.length;
			if (caret > length) {
				console.warn('caret mismatch: ${caret}, value length: ${length}');
				caret = length;
			}
			if (caret > 0) {
				codepoints.splice(caret - 1, 1);
				model.content = codepoints.join('');
				model.caret = caret - 1;
			}
		});
	},
	deleteForward(node): void {
		withModel(node, (model) => {
			const codepoints = [...model.content];
			let caret = model.caret;
			const length = codepoints.length;
			if (caret > length) {
				console.warn('caret mismatch: ${caret}, value length: ${length}');
				caret = length;
			}
			if (caret < length) {
				codepoints.splice(caret, 1);
				model.content = codepoints.join('');
			}
		});
	},
	moveBack(node): void {
		withModel(node, (model) => {
			const caret = model.caret;
			model.caret = Math.max(0, caret - 1);
		});
	},
	moveForward(node): void {
		withModel(node, (model) => {
			const caret = model.caret;
			const codepoints = [...model.content];
			model.caret = Math.min(codepoints.length, caret + 1);
		});
	},
	moveMin(node): void {
		withModel(node, (model) => {
			model.caret = 0;
		});
	},
	moveMax(node): void {
		withModel(node, (model) => {
			model.caret = [...model.content].length;
		});
	},
});

export const { insert, deleteForward, deleteBackward, moveForward, moveBack, moveMin, moveMax } =
	InputApi.methods;

interface InputModel {
	content: string;
	caret: number;
}

const InputContext = createContext<InputModel>('input');

function isInput(node: Node): boolean {
	return InputContext.hasOwn(node);
}

function withModel(node: Node, fn: (model: InputModel) => void): void {
	if (isInput(node)) {
		const model = InputContext.expect(node);
		const originalContent = model.content;
		const originalCaret = model.caret;
		fn(model);
		const contentChanged = originalContent !== model.content;
		const caretChanged = originalCaret !== model.caret;
		if (contentChanged) {
			emit(node, {
				type: 'input',
				value: model.content,
			});
		}
		// Caret-only movement must repaint without emitting a value-change event.
		if (contentChanged || caretChanged) requestRender(node);
	}
}

function handleKeyEvent(node: Node, event: KeyDown | KeyRepeat): boolean {
	if (isInput(node)) {
		if (event.text && event.text?.length > 0) {
			insert(node, event.text);
			return true;
		} else if (event.code === 'Backspace') {
			deleteBackward(node);
			return true;
		} else if (event.code === 'Delete') {
			deleteForward(node);
			return true;
		} else if (event.code === 'ArrowLeft') {
			moveBack(node);
			return true;
		} else if (event.code === 'ArrowRight') {
			moveForward(node);
			return true;
		} else if (event.code === 'Home') {
			moveMin(node);
			return true;
		} else if (event.code === 'End') {
			moveMax(node);
			return true;
		}
	}
	return false;
}

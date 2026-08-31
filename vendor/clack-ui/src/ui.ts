import type { ReadStream, WriteStream } from 'node:tty';
import {
	alternateBuffer,
	createTerm,
	CSI,
	cursor,
	settings,
	type Setting,
	type Term,
} from '@bomb.sh/tty';
import { DispatchApi, useDispatch } from './dispatch.ts';
import { useBoxElement } from './elements/box.ts';
import { useInputElement } from './elements/input.ts';
import { useTextElement } from './elements/text.ts';
import { useFocusNavigation } from './focus-navigation.ts';
import { useFocus } from './focus.ts';
import { useHostRenderer } from './host-render.ts';
import { createHost, type Host } from './host.ts';
import { useKeyboard } from './keyboard.ts';
import { layout } from './layout.ts';
import { RenderApi } from './render.ts';
import { createInputLoop } from './input-loop.ts';

export interface UIOptions {
	height?: number;
	inline?: boolean;
	width?: number;
	input: ReadStream;
	output: WriteStream;
}

export interface UI extends AsyncDisposable {
	host: Host;
	main(): Promise<void>;
}

export async function createUI(options: UIOptions): Promise<UI> {
	const { output } = options;
	const { inline = false } = options;
	const { width = output.columns ?? 80 } = options;
	const { height = output.rows ?? 24 } = options;
	const term = await createTerm({ width, height });

	const host = createHost();

	useDispatch(host);
	useFocus(host);
	useKeyboard(host);
	useFocusNavigation(host);
	useBoxElement(host);
	useTextElement(host);
	useInputElement(host);
	useHostRenderer(host);

	const nextLine: Setting = {
		apply: new Uint8Array(),
		revert: new TextEncoder().encode('\r\n'),
	};
	const setup = inline
		? settings(cursor(false), nextLine)
		: settings(cursor(false), alternateBuffer());

	let stopped = false;
	let firstRender = true;

	// Deliberately naive: every request immediately lays out and renders the entire Host tree.
	RenderApi.around(host.root, {
		requestRender([node], next) {
			if (!stopped) {
				next(node);
				RenderApi.methods.render(node, output, term, [...layout(host.root)]);
			}
		},
		// Renderer strategy as middleware. Inline mode repositions the cursor and
		// paints in line mode via a term facade; fullscreen delegates to the core.
		render([_node, innerOutput, innerTerm, ops], next) {
			if (inline && !firstRender) {
				if (height > 1) {
					innerOutput.write(CSI(`${height - 1}A`));
				}
				innerOutput.write(CSI('1G'));
			}
			const lineMode: Term = { render: (o) => innerTerm.render(o, { mode: 'line' }) };
			const result = next(_node, innerOutput, inline ? lineMode : innerTerm, ops);
			firstRender = false;
			return result;
		},
	});

	output.write(setup.apply);

	return {
		host,
		async [Symbol.asyncDispose]() {
			stopped = true;
			output.write(setup.revert);
		},

		async main(): Promise<void> {
			const controller = new AbortController();
			const { input: stdin } = options;
			try {
				stdin.setRawMode(true);
				stdin.resume();

				input: for await (const events of createInputLoop({
					stdin,
					signal: controller.signal,
				})) {
					for (const event of events) {
						if (event.type === 'keydown' && event.ctrl === true && event.code === 'c') {
							break input;
						}

						const dispatched = DispatchApi.methods.dispatch(host.root, event);
						if (!dispatched.ok) {
							// do something maybe?
						}
					}
				}
			} finally {
				controller.abort();
				stdin.setRawMode(false);
				stdin.pause();
			}
		},
	};
}

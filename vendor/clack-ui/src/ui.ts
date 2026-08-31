import type { ReadStream, WriteStream } from 'node:tty';
import {
	alternateBuffer,
	createTerm,
	CSI,
	cursor,
	settings,
	type Op,
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

	const rendererOptions = { height, output, term };
	const { setup, render } = inline
		? createInlineRenderer(rendererOptions)
		: createFullscreenRenderer(rendererOptions);
	let stopped = false;

	// Deliberately naive: every request immediately lays out and renders the entire Host tree.
	RenderApi.around(host.root, {
		requestRender([node], next) {
			if (!stopped) {
				next(node);
				render([...layout(host.root)]);
			}
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

function createInlineRenderer({ height, output, term }: RendererOptions): Renderer {
	let firstRender = true;
	const nextLine: Setting = {
		apply: new Uint8Array(),
		revert: new TextEncoder().encode('\r\n'),
	};

	return {
		setup: settings(cursor(false), nextLine),
		render(ops) {
			if (!firstRender) {
				if (height > 1) {
					output.write(CSI(`${height - 1}A`));
				}
				output.write(CSI('1G'));
			}
			output.write(term.render(ops, { mode: 'line' }).output);
			firstRender = false;
		},
	};
}

function createFullscreenRenderer({ output, term }: RendererOptions): Renderer {
	return {
		setup: settings(cursor(false), alternateBuffer()),
		render(ops) {
			output.write(term.render(ops).output);
		},
	};
}

interface Renderer {
	setup: Setting;
	render(ops: Op[]): void;
}

interface RendererOptions {
	height: number;
	output: WriteStream;
	term: Term;
}

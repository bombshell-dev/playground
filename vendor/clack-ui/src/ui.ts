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
import { useButtonElement } from './elements/button.ts';
import { useDialogElement } from './elements/dialog.ts';
import { useFormElement } from './elements/form.ts';
import { useInputElement } from './elements/input.ts';
import { useTextElement } from './elements/text.ts';
import { useFocusNavigation } from './focus-navigation.ts';
import { useFocus } from './focus.ts';
import { useHostRenderer } from './host-render.ts';
import { createHost, type Host } from './host.ts';
import { useKeyboard } from './keyboard.ts';
import { loadDeclaredExtensions, registeredUIExtensions } from './extensions.ts';
import { layout } from './layout.ts';
import { RenderApi } from './render.ts';
import type { UIExtension } from './extensions.ts';
import { createInputLoop } from './input-loop.ts';

export interface UIOptions {
	height?: number;
	inline?: boolean;
	width?: number;
	input: ReadStream;
	output: WriteStream;
	extensions?: UIExtension[];
}

export interface UI extends AsyncDisposable {
	host: Host;
	main(): Promise<void>;
}

export async function createUI(options: UIOptions): Promise<UI> {
	const { output } = options;
	const { inline = false } = options;
	const surfaceAt = (): { width: number; height: number } => ({
		width: options.width || output.columns || 80,
		height: options.height || output.rows || 24,
	});
	// Live dimensions: tracked with `let` so the resize handler can update them.
	let { width, height } = surfaceAt();
	let term = await createTerm({ width, height });

	const host = createHost();

	useDispatch(host);
	useFocus(host);
	useKeyboard(host);
	useFocusNavigation(host);
	useBoxElement(host);
	useDialogElement(host);
	useButtonElement(host);
	useFormElement(host);
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

	// Extensions run after createUI's own middleware, so they resolve inner in
	// the chain. Explicit first, then package.json declarations, then the
	// out-of-band registry (later-installed = deeper).
	const extensions: UIExtension[] = [
		...(options.extensions ?? []),
		...(await loadDeclaredExtensions(process.cwd())),
		...registeredUIExtensions(),
	];
	const extensionContext = {
		host,
		input: options.input,
		output,
		get width() {
			return width;
		},
		get height() {
			return height;
		},
		inline,
	};
	for (const extension of extensions) {
		extension(extensionContext);
	}

	output.write(setup.apply);

	// Resize: the terminal owns the truth about its size. Re-create the term at
	// the new dimensions and re-render the whole tree. createTerm is async, so
	// rapid resizes race; only the newest term may win the swap.
	let resizeToken = 0;
	const onResize = (): void => {
		({ width, height } = surfaceAt());
		const token = ++resizeToken;
		void createTerm({ width, height }).then((next) => {
			if (token !== resizeToken) return;
			term = next;
			RenderApi.methods.requestRender(host.root);
		});
	};
	if (typeof output.on === 'function') {
		output.on('resize', onResize);
	}

	return {
		host,
		async [Symbol.asyncDispose]() {
			stopped = true;
			if (typeof output.off === 'function') output.off('resize', onResize);
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
						if (!dispatched.ok) throw dispatched.reason;
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

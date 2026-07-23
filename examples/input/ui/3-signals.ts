import { box, text, createRoot } from '@clack/ui';
import { createInput, type InputEvent } from '@bomb.sh/tty';
import { signal, effect } from 'alien-signals';
import { cyan, white, gray, blue, yellow, green } from './helper.ts';

const root = await createRoot();
const input = await createInput();

interface State {
	inputBuffer: string;
	lastKey: string;
}

const state = signal<State>({ inputBuffer: '', lastKey: '' });

// Same pure function as ./2-parser.ts
function processEvent(s: State, event: InputEvent): State {
	if (event.type !== 'keydown') return s;
	// calling process.exit() here is a bad idea because it doesn't give the caller
	// a chance to clean up terminal modes. See ./4-modes.ts for a better approach.
	if (event.ctrl && event.code === 'c') process.exit(0);
	if (event.code === 'Backspace') {
		return { ...s, inputBuffer: s.inputBuffer.slice(0, -1), lastKey: 'Backspace' };
	}
	if (event.code === 'Enter') {
		return { ...s, inputBuffer: '', lastKey: 'Enter' };
	}
	if (event.code === 'Escape') {
		return { ...s, lastKey: 'Escape' };
	}
	if (event.code.startsWith('Arrow')) {
		return { ...s, lastKey: event.code };
	}
	if (event.text) {
		return {
			...s,
			inputBuffer: s.inputBuffer + event.text,
			lastKey: `Char: ${JSON.stringify(event.text)}`,
		};
	}
	return s;
}

// Process all events from this batch and update the state signal. If the data changed,
// effect() will automatically re-run the render callback.
function processEvents(events: InputEvent[]): void {
	let current = state();
	for (const event of events) {
		current = processEvent(current, event);
	}
	state(current);
}

// Here our state changes automatically trigger a re-render via effect().
effect(() => {
	const s = state();
	root.render(
		box(
			{
				layout: { direction: 'ttb', gap: 1, padding: { top: 1, bottom: 1, left: 2, right: 2 } },
				border: { color: blue, top: 1, right: 1, bottom: 1, left: 1 },
			},
			text({ color: cyan }, 'Reactive Signals'),
			text({ color: gray }, 'Same processEvent, but effect() auto-renders on state change'),
			box(
				{ layout: { direction: 'ltr', gap: 0 } },
				text({ color: yellow }, '> '),
				text({ color: white }, s.inputBuffer || '(type something)'),
			),
			text({ color: gray }, s.lastKey ? `Last: ${s.lastKey}` : ''),
			text({ color: green }, 'Arrow keys, Escape, and special keys all work'),
			text({ color: gray }, 'Press Ctrl+C to exit'),
		),
	);
});

process.stdin.setRawMode(true);
let timer: ReturnType<typeof setTimeout>;

process.stdin.on('data', (buf: Buffer) => {
	clearTimeout(timer);
	const { events, pending } = input.scan(new Uint8Array(buf));
	// We can more confidently process the events here since effect() will handle re-rendering.
	// This is a more robust solution than ./2-parser.ts as we don't need to worry about
	// batching state changes and rendering at the right time.
	processEvents(events);
	if (pending) {
		timer = setTimeout(() => {
			processEvents(input.scan().events);
		}, pending.delay);
	}
});

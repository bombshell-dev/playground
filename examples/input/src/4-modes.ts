import { box, text, createRoot } from '@clack/ui';
import { createInput, alternateBuffer, settings, type InputEvent } from '@bomb.sh/tty';
import { signal, effect } from 'alien-signals';
import { cyan, white, gray, blue, yellow, green } from './helper.ts';

// ./3-signals.ts gave us signals + effect() for reactive rendering, but every event
// was a local state change where effect() was able to handle it all. Some events
// need to do more: exit the process, revert terminal modes, trigger I/O or other computation.
// For a concrete example: In ./3-signals.ts, we just called process.exit() inside processEvent,
// but that only works when there's nothing to clean up.

// This adds terminal settings which require the mode to be reverted
// before exiting. We can't call process.exit() inside processEvent() because it doesn't
// give the caller a chance to revert the terminal modes.

const root = await createRoot();
const input = await createInput();

interface State {
	inputBuffer: string;
	lastKey: string;
	quit: boolean;
}

const state = signal<State>({ inputBuffer: '', lastKey: '', quit: false });

// Same processEvent as ./3-signals.ts, but quit becomes a flag instead of
// calling process.exit() directly.
function processEvent(s: State, event: InputEvent): State {
	if (event.type !== 'keydown') return s;
	if (event.ctrl && event.code === 'c') return { ...s, quit: true };
	if (event.code === 'Escape') return { ...s, quit: true };
	if (event.code === 'Backspace') {
		return { ...s, inputBuffer: s.inputBuffer.slice(0, -1), lastKey: 'Backspace' };
	}
	if (event.code === 'Enter') {
		return { ...s, inputBuffer: '', lastKey: 'Enter' };
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

function processEvents(events: InputEvent[]): State {
	let current = state();
	for (const event of events) {
		current = processEvent(current, event);
	}
	state(current);
	return current;
}

// Alternate buffer keeps the user's scrollback clean, but this
// needs to be reverted before exiting; see quit() below.
const mode = settings(alternateBuffer({ clear: true }));
process.stdout.write(mode.apply);

effect(() => {
	const s = state();
	root.render(
		box(
			{
				layout: { direction: 'ttb', gap: 1, padding: { top: 1, bottom: 1, left: 2, right: 2 } },
				border: { color: blue, top: 1, right: 1, bottom: 1, left: 1 },
			},
			text({ color: cyan }, 'Terminal Modes'),
			text({ color: gray }, 'Same input as ./3-signals.ts, but in an alternate buffer'),
			box(
				{ layout: { direction: 'ltr', gap: 0 } },
				text({ color: yellow }, '> '),
				text({ color: white }, s.inputBuffer || '(type something)'),
			),
			text({ color: gray }, s.lastKey ? `Last: ${s.lastKey}` : ''),
			text({ color: green }, 'Arrow keys, Escape, and special keys all work'),
			text({ color: gray }, 'Press Escape to exit (reverts terminal modes)'),
		),
	);
});

function quit(): void {
	process.stdout.write(mode.revert);
	process.exit(0);
}

process.stdin.setRawMode(true);
let timer: ReturnType<typeof setTimeout>;

process.stdin.on('data', (buf: Buffer) => {
	clearTimeout(timer);
	const { events, pending } = input.scan(new Uint8Array(buf));
	// We can process different outcomes from processEvents() here,
	// but the data handler is getting overloaded. Imagine handling a quit
	// event which raises a modal to request confirmation before quitting.
	// See ./5-stream.ts for a more robust approach.
	const after = processEvents(events);
	if (after.quit) quit();
	if (pending) {
		timer = setTimeout(() => {
			const afterFlush = processEvents(input.scan().events);
			if (afterFlush.quit) quit();
		}, pending.delay);
	}
});

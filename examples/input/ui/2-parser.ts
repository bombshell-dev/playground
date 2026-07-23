import { box, text, createRoot } from '@clack/ui';
import { createInput, type InputEvent } from '@bomb.sh/tty';
import { cyan, white, gray, blue, yellow, green } from './helper.ts';

const root = await createRoot();
// createInput() returns a parser that decodes raw VT/ANSI bytes
// into structured InputEvents (keydown, mousemove, cursor, etc.).
const input = await createInput();

let inputBuffer = '';
let lastKey = '';

function render(): void {
	root.render(
		box(
			{
				layout: { direction: 'ttb', gap: 1, padding: { top: 1, bottom: 1, left: 2, right: 2 } },
				border: { color: blue, top: 1, right: 1, bottom: 1, left: 1 },
			},
			text({ color: cyan }, 'Input Parser'),
			text({ color: gray }, 'Uses createInput() — arrow keys parsed correctly'),
			box(
				{ layout: { direction: 'ltr', gap: 0 } },
				text({ color: yellow }, '> '),
				text({ color: white }, inputBuffer || '(type something)'),
			),
			text({ color: gray }, lastKey ? `Last: ${lastKey}` : ''),
			text({ color: green }, 'Arrow keys, Escape, and special keys all work'),
			text({ color: gray }, 'Press Ctrl+C to exit'),
		),
	);
}

// Paint the initial frame before we start reading input.
render();
// This function handles the parsed input and is a separate function as we need to call it from two places.
function processEvent(
	event: InputEvent,
	s: { inputBuffer: string; lastKey: string },
): { inputBuffer: string; lastKey: string } {
	if (event.type !== 'keydown') return s;
	if (event.ctrl && event.code === 'c') process.exit(0);
	if (event.code === 'Backspace')
		return { inputBuffer: s.inputBuffer.slice(0, -1), lastKey: 'Backspace' };
	if (event.code === 'Enter') return { inputBuffer: '', lastKey: 'Enter' };
	if (event.code === 'Escape') return { ...s, lastKey: 'Escape' };
	if (event.code.startsWith('Arrow')) return { ...s, lastKey: event.code };
	if (event.text)
		return {
			inputBuffer: s.inputBuffer + event.text,
			lastKey: `Char: ${JSON.stringify(event.text)}`,
		};
	return s;
}

// Accumulate state from events so we can call render once
function processEvents(events: InputEvent[]): void {
	for (const event of events) {
		const next = processEvent(event, { inputBuffer, lastKey });
		inputBuffer = next.inputBuffer;
		lastKey = next.lastKey;
	}
}

process.stdin.setRawMode(true);
let timer: ReturnType<typeof setTimeout>;

// Each data chunk is raw bytes from the terminal. `input.scan()` feeds them
// into the parser, which emits zero or more structured events plus a
// `pending` hint if an incomplete escape sequence was encountered.
process.stdin.on('data', (buf: Buffer) => {
	clearTimeout(timer);
	const { events, pending } = input.scan(new Uint8Array(buf));
	processEvents(events);
	if (pending) {
		// A partial escape sequence was split across chunks (e.g. arrow key bytes
		// arriving in two data events). Wait for the remainder to arrive, flush it
		// through the parser, then render once with all events processed.
		timer = setTimeout(() => {
			processEvents(input.scan().events);
			render();
		}, pending.delay);
	} else {
		// This conditional render has becomes more complicated with scale however
		// as we need to track state changes through multiple events and appropriately
		// render once at the end. See ./3-signals.ts for a more robust solution.
		render();
	}
});

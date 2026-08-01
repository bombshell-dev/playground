import { box, text, createRoot } from '@clack/ui';
import { createInput, alternateBuffer, settings, type InputEvent } from '@bomb.sh/tty';
import { signal, effect } from 'alien-signals';
import { cyan, white, gray, blue, yellow, green } from './helper.ts';

// ./4-modes.ts's data handler was getting overloaded — processEvents, quit checks,
// pending flush timers, all crammed into one callback. An async iterator
// moves that complexity into its own function, so the consumer just writes
// `for await (const event of events())` and handles one event at a time.
// The pending-flush timer lives inside the iterator; the consumer never sees it.

const root = await createRoot();
const input = await createInput();

interface State {
	inputBuffer: string;
	lastKey: string;
	quit: boolean;
}

const state = signal<State>({ inputBuffer: '', lastKey: '', quit: false });

// Same processEvent as ./4-modes.ts.
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

const mode = settings(alternateBuffer({ clear: true }));
process.stdout.write(mode.apply);

// Note that our state is still reactive, but holds the sole ownership is triggering a render.
// But how would you handle events which require a render, but aren't directly attached to a state change?
// See ./6-events.ts for an example of handling many events including from a mouse.
effect(() => {
	const s = state();
	root.render(
		box(
			{
				layout: { direction: 'ttb', gap: 1, padding: { top: 1, bottom: 1, left: 2, right: 2 } },
				border: { color: blue, top: 1, right: 1, bottom: 1, left: 1 },
			},
			text({ color: cyan }, 'Stream Input'),
			text({ color: gray }, 'Async iterator hides the pending-flush timer from the consumer'),
			box(
				{ layout: { direction: 'ltr', gap: 0 } },
				text({ color: yellow }, '> '),
				text({ color: white }, s.inputBuffer || '(type something)'),
			),
			text({ color: gray }, s.lastKey ? `Last: ${s.lastKey}` : ''),
			text({ color: green }, 'Arrow keys, Escape, and special keys all work'),
			text({ color: gray }, 'Press Escape to exit'),
		),
	);
});

// The iterator owns the pending-flush timer. The consumer just gets a stream
// of events and doesn't need to know about chunk splitting or timeouts.
// We could choose to make this a function within `@clack/ui` and
// have it return an AsyncIterable<InputEvent> directly.
const queue: InputEvent[] = [];
let resolver = Promise.withResolvers<void>();

function push(events: InputEvent[]): void {
	queue.push(...events);
	resolver.resolve();
	resolver = Promise.withResolvers<void>();
}

function stdinEvents(): AsyncIterable<InputEvent> {
	return {
		[Symbol.asyncIterator]() {
			return {
				async next() {
					while (queue.length === 0) {
						await resolver.promise;
					}
					return { value: queue.shift()!, done: false };
				},
			};
		},
	};
}

// A flush timer is only outstanding while the parser holds a partial sequence.
// Every new chunk clears an outstanding flush timer as it is no longer relevant.
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(pending: ReturnType<typeof input.scan>['pending']): void {
	if (flushTimer !== null) clearTimeout(flushTimer);
	if (!pending) {
		flushTimer = null;
		return;
	}
	flushTimer = setTimeout(() => {
		flushTimer = null;
		const flush = input.scan();
		push(flush.events);
		// Still partial? Schedule another flush
		scheduleFlush(flush.pending);
	}, pending.delay);
}

function processChunk(buf: Uint8Array): void {
	const { events, pending } = input.scan(buf);
	push(events);
	scheduleFlush(pending);
}

process.stdin.setRawMode(true);
process.stdin.on('data', (buf: Buffer) => processChunk(new Uint8Array(buf)));

// The consumer is now a simple loop with no timers or flush logic.
// Each event is processed and the quit flag is checked immediately afterwards.
for await (const event of stdinEvents()) {
	const after = processEvents([event]);
	if (after.quit) {
		process.stdout.write(mode.revert);
		process.exit(0);
	}
}

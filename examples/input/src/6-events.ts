import { box, text, createRoot } from '@clack/vendored.ui';
import {
	createInput,
	alternateBuffer,
	settings,
	mouseTracking,
	rgba,
	type InputEvent,
} from '@bomb.sh/tty';
import { signal, effect } from 'alien-signals';
import { cyan, white, gray, green } from './helper.ts';

// ./5-stream.ts gave us an async iterator over stdin events. But stdin can
// carry keyboard, mouse, and resize events, and we can handle all these
// through the same iterator.
// This example shows how one stream feeds a reactive state model. The box
// color reacts to your input: typing speed pushes red, mouse distance
// pushes blue. Window resizes redraw the layout.
// The progression from 5→6 is: one iterator, multiple event sources.

const input = await createInput();

const renderTick = signal(0);

interface State {
	inputBuffer: string;
	lastKey: string;
	quit: boolean;
	keyIntensity: number;
	lastKeyAt: number;
	mouse: { x: number; y: number };
	size: { width: number; height: number };
}

const state = signal<State>({
	inputBuffer: '',
	lastKey: '',
	quit: false,
	keyIntensity: 0,
	lastKeyAt: 0,
	mouse: { x: 0, y: 0 },
	size: { width: process.stdout.columns, height: process.stdout.rows },
});

const intensityPerKey = 5; // each key adds this until maximum intensity
const maxKeyIntensity = 20; // max for visual typing intensity, each key adds intensityPerKey
const typingDecay = 400; // ms

function processEvent(s: State, event: InputEvent): State {
	if (event.type === 'keydown') {
		const now = performance.now();
		const elapsed = now - s.lastKeyAt;
		// value based on time due to decay
		const decayed = Math.max(0, s.keyIntensity * Math.exp(-elapsed / typingDecay));
		const next = Math.min(decayed + intensityPerKey, maxKeyIntensity);
		if (event.ctrl && event.code === 'c') return { ...s, quit: true };
		if (event.code === 'Escape') return { ...s, quit: true };
		if (event.code === 'Backspace') {
			return {
				...s,
				inputBuffer: s.inputBuffer.slice(0, -1),
				lastKey: 'Backspace',
				keyIntensity: next,
				lastKeyAt: now,
			};
		}
		if (event.code === 'Enter') {
			return { ...s, inputBuffer: '', lastKey: 'Enter', keyIntensity: next, lastKeyAt: now };
		}
		if (event.code.startsWith('Arrow')) {
			return { ...s, lastKey: event.code, keyIntensity: next, lastKeyAt: now };
		}
		if (event.text) {
			return {
				...s,
				inputBuffer: s.inputBuffer + event.text,
				lastKey: `Char: ${JSON.stringify(event.text)}`,
				keyIntensity: next,
				lastKeyAt: now,
			};
		}
		return s;
	}
	if (event.type === 'mousemove' || event.type === 'mousedown' || event.type === 'mouseup') {
		return { ...s, mouse: { x: event.x, y: event.y } };
	}
	if (event.type === 'resize') {
		return { ...s, size: { width: event.width, height: event.height } };
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

// mouseTracking() adds SGR mouse reports. Resize events come through
// automatically when the terminal window changes size.
const mode = settings(alternateBuffer({ clear: true }), mouseTracking());
process.stdout.write(mode.apply);

const root = await createRoot();

function buildBox(): ReturnType<typeof box> {
	const s = state();

	const elapsed = performance.now() - s.lastKeyAt;
	const intensity = Math.max(0, s.keyIntensity * Math.exp(-elapsed / typingDecay));
	// Normalize value from 0 to 1 to scale max red
	const intensityRange = Math.min(intensity / maxKeyIntensity, 1);
	const maxRed = 200; // Max red for RGB
	const redFromIntensity = Math.round(intensityRange * maxRed);

	// Mouse proximity to box, from top-left corner (where the box sits)
	// divided by the terminal diagonal. Closer = more blue.
	const maxDist = Math.sqrt(s.size.width ** 2 + s.size.height ** 2);
	const distance = Math.sqrt(s.mouse.x ** 2 + s.mouse.y ** 2);
	const blueFromDistance = Math.round(Math.min((maxDist - distance) / maxDist, 1) * 200);

	// Determine box size and pulse color on hover
	const insideBox = s.mouse.y < 15 && s.mouse.x < s.size.width;
	const pulseMaxIntensity = 40; // Max pulse, adds to RGB value
	// 150ms period to pulse over 300ms, * 0.5 + 0.5 to normalize from 0 to 1, then scale by pulseMaxIntensity
	const pulse = insideBox ? (Math.sin(performance.now() / 150) * 0.5 + 0.5) * pulseMaxIntensity : 0;

	return box(
		{
			layout: { direction: 'ttb', gap: 1, padding: { top: 1, bottom: 1, left: 2, right: 2 } },
			border: {
				color: rgba(40, 40, 60 + blueFromDistance / 3),
				top: 1,
				right: 1,
				bottom: 1,
				left: 1,
			},
			bg: rgba(redFromIntensity + pulse, 2, blueFromDistance + pulse),
			transition: { duration: 0.1, easing: 'easeOut', properties: ['bg'] },
		},
		text({ color: cyan }, 'Stream Events'),
		text({ color: gray }, 'One iterator handles keyboard, mouse, transitions, and resize'),
		box(
			{ layout: { direction: 'ltr', gap: 0 } },
			text({ color: green }, '> '),
			text({ color: white }, s.inputBuffer || '(type something)'),
		),
		text({ color: gray }, s.lastKey ? `Last: ${s.lastKey}` : ''),
		text({ color: gray }, `Mouse: (${s.mouse.x}, ${s.mouse.y})`),
		text({ color: gray }, `Size: ${s.size.width}x${s.size.height}`),
	);
}

// effect() re-renders when any signal changes
effect(() => {
	state();
	// primes the `renderTick` signal so `renderTimer` changes fire `effect()`
	renderTick();
	root.render(buildBox());
});

// Tick every 50ms so the effect re-fires and `buildBox` recomputes the
// time-based intensity decay. Without this, the visual would only update
// on keystrokes.
const renderTimer = setInterval(() => {
	renderTick(renderTick() + 1);
}, 50);

// Same iterator as ./5-stream.ts — it already yields mouse and resize events.
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

let pending: ReturnType<typeof input.scan>['pending'];

function processChunk(buf: Uint8Array): void {
	const { events, pending: p } = input.scan(buf);
	push(events);
	if (pending) return;
	pending = p;
	if (pending) {
		setTimeout(() => {
			const flush = input.scan();
			push(flush.events);
			pending = flush.pending;
			if (pending) processChunk(new Uint8Array());
		}, pending.delay);
	}
}

process.stdin.setRawMode(true);
process.stdin.on('data', (buf: Buffer) => processChunk(new Uint8Array(buf)));

for await (const event of stdinEvents()) {
	const after = processEvents([event]);
	if (after.quit) {
		clearInterval(renderTimer);
		process.stdout.write(mode.revert);
		process.exit(0);
	}
}

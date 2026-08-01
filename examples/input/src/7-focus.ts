import { box, text, createRoot, rgba } from '@clack/vendored.ui';
import {
	createInput,
	alternateBuffer,
	settings,
	mouseTracking,
	type InputEvent,
} from '@bomb.sh/tty';
import { signal, effect } from 'alien-signals';
import { cyan, white, gray, green, blue } from './helper.ts';

// 6-events.ts showed one input reacting with transitions responding to keyboard, mouse, and resize.
// This example adds another input. Two panels, same state model, same transitions.
// With two inputs, a focus index determines which panel receives keystrokes.
// Everything else is identical to ./6-events.ts.

const input = await createInput();

const renderTick = signal(0);

interface Panel {
	inputBuffer: string;
	lastKey: string;
	keyIntensity: number;
	lastKeyAt: number;
}

interface State {
	panels: [Panel, Panel];
	focusIndex: number;
	mouse: { x: number; y: number };
	size: { width: number; height: number };
	quit: boolean;
}

function blankPanel(): Panel {
	return { inputBuffer: '', lastKey: '', keyIntensity: 0, lastKeyAt: 0 };
}

const state = signal<State>({
	panels: [blankPanel(), blankPanel()],
	focusIndex: 0,
	mouse: { x: 0, y: 0 },
	size: { width: process.stdout.columns, height: process.stdout.rows },
	quit: false,
});

const intensityPerKey = 5;
const maxKeyIntensity = 20;
const typingDecay = 400;

function processEvent(s: State, event: InputEvent): State {
	if (event.type === 'keydown') {
		if (event.ctrl && event.code === 'c') return { ...s, quit: true };
		if (event.code === 'Escape') return { ...s, quit: true };
		// Cue manual focus management. This is easy to handle in small, naive examples like this,
		// but real TUIs with many focusable elements and complex tab order may benefit from a more
		// robust solution. In a browser, the DOM handles this for you through the tree of DOM nodes.
		if (event.code === 'Tab') return { ...s, focusIndex: (s.focusIndex + 1) % s.panels.length };
		if (event.code === 'Backtab')
			return { ...s, focusIndex: (s.focusIndex - 1 + s.panels.length) % s.panels.length };

		// Everything below applies to the focused panel — identical to ./6-events.ts
		const now = performance.now();
		const currentFocusedIndex = s.focusIndex;
		const currentFocusedPanel = s.panels[currentFocusedIndex]!;
		const elapsed = now - currentFocusedPanel.lastKeyAt;
		const decayed = Math.max(
			0,
			currentFocusedPanel.keyIntensity * Math.exp(-elapsed / typingDecay),
		);
		const next = Math.min(decayed + intensityPerKey, maxKeyIntensity);

		let updated: Panel;
		if (event.code === 'Backspace') {
			updated = {
				...currentFocusedPanel,
				inputBuffer: currentFocusedPanel.inputBuffer.slice(0, -1),
				lastKey: 'Backspace',
				keyIntensity: next,
				lastKeyAt: now,
			};
		} else if (event.code === 'Enter') {
			updated = {
				...currentFocusedPanel,
				inputBuffer: '',
				lastKey: 'Enter',
				keyIntensity: next,
				lastKeyAt: now,
			};
		} else if (event.code.startsWith('Arrow')) {
			updated = {
				...currentFocusedPanel,
				lastKey: event.code as string,
				keyIntensity: next,
				lastKeyAt: now,
			};
		} else if (event.text) {
			updated = {
				...currentFocusedPanel,
				inputBuffer: currentFocusedPanel.inputBuffer + event.text,
				lastKey: `Char: ${JSON.stringify(event.text)}`,
				keyIntensity: next,
				lastKeyAt: now,
			};
		} else {
			return s;
		}

		const panels: [Panel, Panel] = [...s.panels] as [Panel, Panel];
		panels[currentFocusedIndex] = updated;
		return { ...s, panels };
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

const mode = settings(alternateBuffer({ clear: true }), mouseTracking());
process.stdout.write(mode.apply);

const root = await createRoot();

function buildFocusedPanel(p: Panel, s: State): ReturnType<typeof box> {
	const elapsed = performance.now() - p.lastKeyAt;
	const intensity = Math.max(0, p.keyIntensity * Math.exp(-elapsed / typingDecay));
	const intensityRange = Math.min(intensity / maxKeyIntensity, 1);
	const maxRed = 200;
	const redFromIntensity = Math.round(intensityRange * maxRed);

	// Panel A starts at row 4, Panel B at row 14 (each panel is 9 rows tall)
	const panelTop = s.focusIndex === 0 ? 4 : 14;
	const panelHeight = 9;
	const panelCenterY = panelTop + panelHeight / 2;
	const panelCenterX = s.size.width / 2;
	const maxDist = Math.sqrt((s.size.width / 2) ** 2 + (s.size.height / 2) ** 2);
	const dist = Math.sqrt((s.mouse.x - panelCenterX) ** 2 + (s.mouse.y - panelCenterY) ** 2);
	const blueFromDistance = Math.round(Math.min((maxDist - dist) / maxDist, 1) * 200);

	const insideBox =
		s.mouse.y >= panelTop && s.mouse.y < panelTop + panelHeight && s.mouse.x < s.size.width;
	const pulseMaxIntensity = 40;
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
		text({ color: cyan }, `Panel ${s.focusIndex === 0 ? 'A' : 'B'} (focused)`),
		box(
			{ layout: { direction: 'ltr', gap: 0 } },
			text({ color: green }, '> '),
			text({ color: white }, p.inputBuffer || '(type something)'),
		),
		text({ color: gray }, p.lastKey ? `Last: ${p.lastKey}` : ''),
	);
}

function buildUnfocusedPanel(p: Panel, index: number): ReturnType<typeof box> {
	return box(
		{
			layout: { direction: 'ttb', gap: 1, padding: { top: 1, bottom: 1, left: 2, right: 2 } },
			border: { color: gray, top: 1, right: 1, bottom: 1, left: 1 },
		},
		text({ color: gray }, `Panel ${index === 0 ? 'A' : 'B'}`),
		box(
			{ layout: { direction: 'ltr', gap: 0 } },
			text({ color: white }, '  '),
			text({ color: white }, p.inputBuffer || '(type something)'),
		),
		text({ color: gray }, p.lastKey ? `Last: ${p.lastKey}` : ''),
	);
}

function buildBox(): ReturnType<typeof box> {
	const s = state();

	return box(
		{
			layout: { direction: 'ttb', gap: 1, padding: { top: 1, bottom: 1, left: 2, right: 2 } },
			border: { color: blue, top: 1, right: 1, bottom: 1, left: 1 },
		},
		text({ color: cyan }, 'Focus Management'),
		text(
			{ color: gray },
			'Same as ./6-events.ts — twice. Tab/Shift+Tab switches which panel is active.',
		),
		s.focusIndex === 0 ? buildFocusedPanel(s.panels[0]!, s) : buildUnfocusedPanel(s.panels[0]!, 0),
		s.focusIndex === 1 ? buildFocusedPanel(s.panels[1]!, s) : buildUnfocusedPanel(s.panels[1]!, 1),
		text(
			{ color: gray },
			`Mouse: (${s.mouse.x}, ${s.mouse.y}) · Size: ${s.size.width}x${s.size.height}`,
		),
		text({ color: gray }, 'Press Escape to quit'),
	);
}

effect(() => {
	state();
	renderTick();
	root.render(buildBox());
});

const renderTimer = setInterval(() => {
	renderTick(renderTick() + 1);
}, 50);

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

for await (const event of stdinEvents()) {
	const after = processEvents([event]);
	if (after.quit) {
		clearInterval(renderTimer);
		process.stdout.write(mode.revert);
		process.exit(0);
	}
}

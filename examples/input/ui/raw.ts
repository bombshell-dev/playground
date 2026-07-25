import { box, text, createRoot, rgba } from '@clack/ui';

const cyan = rgba(0, 205, 205);
const white = rgba(229, 229, 229);
const gray = rgba(127, 127, 127);
const blue = rgba(0, 0, 238);
const yellow = rgba(255, 255, 0);
const red = rgba(255, 80, 80);

const root = await createRoot();

// a raw variable which we cannot subscribe to
// so we have to re-render on every input event
let inputBuffer = '';
let lastKey = '';

function render(): void {
	root.render(
		box(
			{
				layout: { direction: 'ttb', gap: 1, padding: { top: 1, bottom: 1, left: 2, right: 2 } },
				border: { color: blue, top: 1, right: 1, bottom: 1, left: 1 },
			},
			text({ color: cyan }, 'Level 1 — Raw String Input'),
			text({ color: gray }, 'Uses data.toString() — arrow keys produce garbage'),
			box(
				{ layout: { direction: 'ltr', gap: 0 } },
				text({ color: yellow }, '> '),
				text({ color: white }, inputBuffer || '(type something)'),
			),
			text({ color: gray }, lastKey ? `Last: ${lastKey}` : ''),
			text(
				{ color: red },
				"Arrow keys dump raw ANSI escape sequences into the buffer\nas we don't handle them here. This is expected behavior.",
			),
			text({ color: gray }, 'Press Ctrl+C to exit'),
		),
	);
}

render();

process.stdin.setRawMode(true);
process.stdin.resume();
// listen for input events and call render() on every event
process.stdin.on('data', (data: Buffer) => {
	const str = data.toString();
	if (str === '\x03') {
		// Ctrl+C
		process.exit(0);
	}
	if (str === '\x7f' || str === '\b') {
		// DEL or BS
		inputBuffer = inputBuffer.slice(0, -1);
		lastKey = 'Backspace';
	} else if (str === '\r' || str === '\n') {
		// CR or LF
		inputBuffer = '';
		lastKey = 'Enter';
	} else if (str.startsWith('\x1b')) {
		// ESC — start of ANSI escape sequence
		lastKey = `Raw escape: ${str
			.split('')
			.map((c) => `0x${c.charCodeAt(0).toString(16)}`)
			.join(' ')}`;
		inputBuffer += str;
	} else {
		inputBuffer += str;
		lastKey = `Char: ${JSON.stringify(str)}`;
	}
	render();
});

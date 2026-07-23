import { box, text, createRoot } from '@clack/ui';
import { cyan, white, gray, blue, yellow, red } from './helper.ts';

const root = await createRoot();

let inputBuffer = '';
let lastKey = '';

function render(): void {
	root.render(
		box(
			{
				layout: { direction: 'ttb', gap: 1, padding: { top: 1, bottom: 1, left: 2, right: 2 } },
				border: { color: blue, top: 1, right: 1, bottom: 1, left: 1 },
			},
			text({ color: cyan }, 'Raw String Input'),
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

// Initial render before we start reading input.
render();

// Raw mode pipes all bytes from stdin on 'data'
process.stdin.setRawMode(true);
process.stdin.on('data', (data: Buffer) => {
	// data.toString() allows observation of all input,
	// but it doesn't interpret the terminal protocol so
	// we need to manually handle special keys. See
	// ./2-parser.ts for a more robust solution.
	const str = data.toString();
	if (str === '\x03') {
		process.exit(0);
	}
	if (str === '\x7f' || str === '\b') {
		inputBuffer = inputBuffer.slice(0, -1);
		lastKey = 'Backspace';
	} else if (str === '\r' || str === '\n') {
		inputBuffer = '';
		lastKey = 'Enter';
	} else if (str.startsWith('\x1b')) {
		lastKey = `Raw escape: ${str
			.split('')
			.map((c) => `0x${c.charCodeAt(0).toString(16)}`)
			.join(' ')}`;
		inputBuffer += str;
	} else {
		inputBuffer += str;
		lastKey = `Char: ${JSON.stringify(str)}`;
	}
	// Re-render after every chunk input
	render();
});

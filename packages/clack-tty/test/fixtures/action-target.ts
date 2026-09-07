// oxlint-disable eslint/no-control-regex -- Parse terminal mouse reports, including ESC.
import { encodeFrame, type ClackFrame, type ClackNode } from '../../src/protocol.ts';

// A small interactive protocol fixture: Enter reveals Submit, clicking it
// updates the UI, and ! finishes with an audit of all preceding PTY input.
process.stdin.setRawMode(true);
const mode = process.env.ACTION_TARGET;
let revealed = mode === 'ambiguous';
let frame = 0;
let pressedTarget = -1;
let submitted = 0;
let received = '';
let pending = '';
let finishing = false;

function render(status: string): void {
	const panel = revealed || mode !== 'missing-parent';
	const count = revealed ? (mode === 'ambiguous' ? 2 : 1) : 0;
	const nodes: ClackNode[] = [
		{
			key: 'status',
			name: 'text',
			parent: null,
			order: 0,
			attrs: { label: 'status' },
			geo: geometry({ column: 0, row: 0, width: 40, height: 1 }),
		},
	];
	let paint = '\x1b[2J\x1b[H' + status;
	if (panel) {
		paint += '\x1b[2;1HPanel';
		nodes.push({
			key: 'panel',
			name: 'form',
			parent: null,
			order: 1,
			attrs: { label: 'delivery' },
			geo: geometry({ column: 0, row: 1, width: 40, height: 5 }),
		});
	}
	for (let index = 0; index < count; index++) {
		paint += `\x1b[${index + 3};5H[Submit]`;
		nodes.push({
			key: `submit-${index}`,
			name: 'button',
			parent: 'panel',
			order: index,
			attrs: { label: 'submit' },
			geo: geometry({ column: 4, row: index + 2, width: 8, height: 1 }),
		});
	}
	if (process.env.DESCRIBE === '1') {
		const description: ClackFrame = {
			v: 1,
			frame: ++frame,
			nodes,
			surface: { columns: 80, rows: 24, row: 1 },
		};
		paint += Buffer.from(encodeFrame(description)).toString();
	}
	process.stdout.write(paint);
}
function geometry(term: {
	column: number;
	row: number;
	width: number;
	height: number;
}): NonNullable<ClackNode['geo']> {
	return { term, layout: { x: term.column, y: term.row, width: term.width, height: term.height } };
}
function mouse(event: RegExpMatchArray): void {
	const button = Number(event[1]),
		column = Number(event[2]) - 1,
		row = Number(event[3]) - 1;
	const count = revealed ? (mode === 'ambiguous' ? 2 : 1) : 0;
	const target = column >= 4 && column < 12 && row >= 2 && row < 2 + count ? row - 2 : -1;
	if (button === 51 && target !== -1) {
		render('Hover: control'); // SGR motion without a button, with Control held.
		return;
	}
	if (button !== 0) return;
	if (event[4] === 'M') pressedTarget = target;
	else {
		if (target !== -1 && pressedTarget === target) render(`Submitted: ${++submitted}`);
		pressedTarget = -1;
	}
}
process.stdin.on('data', (bytes) => {
	if (finishing) return;
	const text = bytes.toString('latin1');
	received += text;
	pending += text;
	while (pending.length) {
		if (pending[0] === '!') {
			finishing = true;
			const prefix = received.slice(0, received.indexOf('!'));
			const audit = Buffer.from(prefix, 'latin1').toString('hex') || '(none)';
			process.stdout.write(`\x1b[7;1HINPUT:${audit}`, () => process.exit(0));
			return;
		}
		if (pending[0] === '\r') {
			pending = pending.slice(1);
			revealed = true;
			render('Ready');
			continue;
		}
		const event = pending.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
		if (event) {
			pending = pending.slice(event[0].length);
			mouse(event);
		} else if (/^\x1b(?:\[(?:<[\d;]*)?)?$/.test(pending)) {
			return; // A mouse report can span several PTY reads.
		} else {
			pending = pending.slice(1); // Still retained in the input audit.
		}
	}
});
process.stdout.write('\x1b[?1003h\x1b[?1006h');
render(revealed ? 'Ready' : 'Loading');

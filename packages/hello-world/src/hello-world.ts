/**
 * A plain clack/ui application. Nothing in this file knows about testing:
 * semantic-tree emission is activated by the launcher (CLACK_UI_SEMANTIC=1)
 * through the extension declared in package.json.
 *
 * Run: `tsx src/hello-world.ts`
 */
import { stdin, stdout } from 'node:process';
import { fixed, grow, percent, rgba } from '@bomb.sh/tty';
import { createUI, type HostElement, type TextProps } from '@clack/ui';

const blue = rgba(0, 0, 238);
const cyan = rgba(0, 205, 205);
const gray = rgba(127, 127, 127);

const columns = stdout.columns || 80;
const rows = stdout.rows || 24;

const ui = await createUI({
	input: stdin,
	output: stdout,
	width: columns,
	height: rows,
});

const { host } = ui;

const sayInput = host.createElement('input');
host.setProperty(sayInput, 'role', 'textbox');
host.setProperty(sayInput, 'label', 'say');

const toInput = host.createElement('input');
host.setProperty(toInput, 'role', 'textbox');
host.setProperty(toInput, 'label', 'to');

const say = host.createLiteral('Hello');
const comma = host.createLiteral(', ');
const to = host.createLiteral('World');
const bang = host.createLiteral('!');

const output = host.createElement('text');
host.setProperty(output, 'color', cyan);
host.insertBefore(output, say);
host.insertBefore(output, comma);
host.insertBefore(output, to);
host.insertBefore(output, bang);

host.addEventListener(sayInput, 'input', (event) => {
	host.setText(say, event.value);
});
host.addEventListener(toInput, 'input', (event) => {
	host.setText(to, event.value);
});

const app = box(
	{
		role: 'group',
		label: 'hello',
		layout: {
			direction: 'ttb',
			gap: 1,
			padding: { top: 1, bottom: 1, left: 2, right: 2 },
			width: fixed(40),
		},
		border: { color: blue, top: 1, right: 1, bottom: 1, left: 1 },
	},
	output,
	box(
		{ layout: { direction: 'ttb', width: grow() } },
		box({ layout: { direction: 'ltr', gap: 1, width: grow() } }, label('say:'), label('to:')),
		box({ layout: { direction: 'ltr', gap: 1, width: grow() } }, sayInput, toInput),
	),
);

host.insertBefore(host.element, app);

await ui.main();

function box(properties: Record<string, unknown>, ...children: HostElement[]): HostElement {
	const element = host.createElement('box');
	for (const [name, value] of Object.entries(properties)) host.setProperty(element, name, value);
	for (const child of children) host.insertBefore(element, child);
	return element;
}

function label(content: string): HostElement {
	return box({ layout: { width: percent(0.3) } }, text({ color: gray }, content));
}

function text(properties: TextProps, content: string): HostElement {
	const element = host.createElement('text');
	for (const [name, value] of Object.entries(properties)) host.setProperty(element, name, value);
	host.insertBefore(element, host.createLiteral(content));
	return element;
}

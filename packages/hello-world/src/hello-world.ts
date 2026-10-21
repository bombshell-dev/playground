/** A plain terminal document; semantic inspection is enabled by its declared extension. */
import { stdin, stdout } from 'node:process';
import { createUI } from '@clack/ui';

await using ui = await createUI({ input: stdin, output: stdout });
const { document } = ui;
const group = document.createElement('box');
group.setAttribute('role', 'group');
group.setAttribute('label', 'hello');
Object.assign(group.style, {
	width: '40px',
	flexDirection: 'column',
	gap: '1px',
	paddingTop: '1px',
	paddingBottom: '1px',
	paddingLeft: '2px',
	paddingRight: '2px',
	borderStyle: 'solid',
	borderColor: '#0000ee',
});
const greeting = document.createElement('text');
greeting.style.color = '#00cdcd';
const say = document.createTextNode('Hello');
const to = document.createTextNode('World');
for (const text of [say, document.createTextNode(', '), to, document.createTextNode('!')])
	greeting.appendChild(text);
group.appendChild(greeting);
const row = document.createElement('box');
row.style.width = '100%';
row.style.gap = '1px';
for (const [label, text] of [
	['say', say],
	['to', to],
] as const) {
	const field = document.createElement('input');
	field.setAttribute('role', 'textbox');
	field.setAttribute('label', label);
	field.addEventListener('input', () => {
		text.data = field.value;
	});
	row.appendChild(field);
}
group.appendChild(row);
document.documentElement.appendChild(group);
await ui.main();

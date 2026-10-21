/** A terminal application without the semantic plugin. */
import { stdin, stdout } from 'node:process';
import { createUI } from '@clack/ui';

await using ui = await createUI({ input: stdin, output: stdout });
const app = ui.document.createElement('box');
Object.assign(app.style, {
	width: '40px',
	paddingTop: '1px',
	paddingLeft: '2px',
	borderStyle: 'solid',
	borderColor: '#0000ee',
});
app.appendChild(ui.document.createTextNode('Plain hello'));
ui.document.documentElement.appendChild(app);
await ui.main();

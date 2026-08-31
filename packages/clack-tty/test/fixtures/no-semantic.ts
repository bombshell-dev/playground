/**
 * Negative fixture: a clack/ui application WITHOUT the semantic plugin.
 * Used to prove emission is opt-in (REQ-014) — no clack.ui OSC may appear.
 */
import { stdin, stdout } from 'node:process';
import { fixed, rgba } from '@bomb.sh/tty';
import { createUI } from '@clack/ui';

const blue = rgba(0, 0, 238);
const cyan = rgba(0, 205, 205);

const ui = await createUI({
	input: stdin,
	output: stdout,
	width: stdout.columns || 80,
	height: stdout.rows || 24,
});
const { host } = ui;

const output = host.createElement('text');
host.setProperty(output, 'color', cyan);
host.insertBefore(output, host.createLiteral('Plain hello'));

const app = host.createElement('box');
host.setProperty(app, 'layout', {
	direction: 'ttb',
	padding: { top: 1, bottom: 1, left: 2, right: 2 },
	width: fixed(40),
});
host.setProperty(app, 'border', { color: blue, top: 1, right: 1, bottom: 1, left: 1 });
host.insertBefore(app, output);
host.insertBefore(host.element, app);

await ui.main();

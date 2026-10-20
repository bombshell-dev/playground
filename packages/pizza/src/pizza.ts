/** Pizza delivery CLI. The same application can also mount into an injected terminal. */
import { stdin, stdout } from 'node:process';
import { createUI } from '@clack/ui';
import { mountPizza } from './app.ts';

const ui = await createUI({ input: stdin, output: stdout });
mountPizza(ui.host);
await ui.main();

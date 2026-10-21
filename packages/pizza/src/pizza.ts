/** Pizza delivery CLI. The same application can also mount into an injected terminal. */
import { stdin, stdout } from 'node:process';
import { createUI } from '@clack/ui';
import { mountPizza } from './app.ts';

await using ui = await createUI({ input: stdin, output: stdout });
await mountPizza(ui.document);
await ui.main();

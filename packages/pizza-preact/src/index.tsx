import { stdin, stdout } from 'node:process';
import { createUI } from '@clack/ui';
import { createRoot } from '@clack/ui-preact';
import { PizzaDelivery } from './app.tsx';

await using ui = await createUI({ input: stdin, output: stdout });
const root = createRoot(ui.host.element);
root.render(<PizzaDelivery />);
await ui.main();

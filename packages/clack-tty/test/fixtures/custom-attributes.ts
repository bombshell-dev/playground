import { stdin, stdout } from 'node:process';
import { createUI } from '@clack/ui';
import { useSemantic } from '../../src/producer.ts';

await using ui = await createUI({ input: stdin, output: stdout });
const { host } = ui;
useSemantic(host, { surface: () => ({ columns: stdout.columns, rows: stdout.rows }) });

const contact = host.createElement('box');
host.setProperty(contact, 'data-__proto__', 'contact');
host.setProperty(contact, 'data-constructor', 'field');
host.setProperty(contact, 'data-toString', 'label');
host.insertBefore(contact, host.createLiteral('Contact details'));
host.insertBefore(host.element, contact);

await ui.main();

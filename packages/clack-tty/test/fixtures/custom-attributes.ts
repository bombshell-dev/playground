import { stdin, stdout } from 'node:process';
import { createUI } from '@clack/ui';
import { useSemantic } from '../../src/producer.ts';

await using ui = await createUI({ input: stdin, output: stdout, extensions: [useSemantic] });
const contact = ui.document.createElement('box');
contact.setAttribute('data-__proto__', 'contact');
contact.setAttribute('data-constructor', 'field');
contact.setAttribute('data-toString', 'label');
contact.appendChild(ui.document.createTextNode('Contact details'));
ui.document.documentElement.appendChild(contact);
await ui.main();

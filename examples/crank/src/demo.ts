import { Document } from '@bomb.sh/dom';
import { createElement as h } from '@b9g/crank';
import { createRoot } from './index.ts';

const document = new Document();
const container = document.appendChild(document.createElement('box'));
const root = createRoot(container);
await root.render(h('text', null, 'Hello from Crank'));
console.info(container.textContent);
await root.unmount();

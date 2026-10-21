import { Document } from '@bomb.sh/dom';
import { h } from 'preact';
import { createRoot } from './index.ts';

const document = new Document();
const container = document.appendChild(document.createElement('box'));
const root = createRoot(container);
root.render(h('text', { 'data-framework': 'preact' }, 'Hello from Preact'));
console.info(container.textContent);
root.unmount();

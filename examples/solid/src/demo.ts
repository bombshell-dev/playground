import { Document } from '@bomb.sh/dom';
import { createSignal } from 'solid-js';
import { createSolidRenderer } from './index.ts';

const document = new Document();
const container = document.appendChild(document.createElement('box'));
const renderer = createSolidRenderer(document);
let update = (_value: string): void => {};
const dispose = renderer.render(() => {
	const [message, setMessage] = createSignal('Hello');
	update = setMessage;
	const text = renderer.createElement('text');
	renderer.insert(text, message);
	return text;
}, container);
update('Hello from Solid');
console.info(container.textContent);
dispose();

import { expect, expectTypeOf, it } from 'vitest';
import { Document, type Element } from '../src/index.ts';

interface TerminalLabel extends Element {
	readonly terminalValue: number;
}
declare module '../src/index.ts' {
	interface Elements {
		'terminal-label': TerminalLabel;
	}
}

it('keeps element-name augmentation tied to a real registered constructor', () => {
	const document = new Document();
	class Label extends document.HTMLElement {
		readonly terminalValue = 42;
	}
	document.customElements.define('terminal-label', Label);
	const label = document.createElement('terminal-label');
	expectTypeOf(label).toEqualTypeOf<TerminalLabel>();
	expect(label).toBeInstanceOf(Label);
	expect(label.terminalValue).toBe(42);
	expectTypeOf(document.createElement('arbitrary-terminal-node')).toEqualTypeOf<Element>();
});

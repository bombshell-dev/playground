/* oxlint-disable bombshell-dev/exported-function-async -- Token list access and mutation are synchronous. */
import type { Element } from './dom.ts';

/** A live ordered token set backed by an attribute. */
export class DOMTokenList implements Iterable<string> {
	readonly #element: Element;
	readonly #attribute: string;
	constructor(element: Element, attribute: string) {
		this.#element = element;
		this.#attribute = attribute;
	}
	get value(): string {
		return this.#element.getAttribute(this.#attribute) ?? '';
	}
	set value(value: string) {
		this.#element.setAttribute(this.#attribute, String(value));
	}
	get length(): number {
		return this.#tokens().length;
	}
	item(index: number): string | null {
		return this.#tokens()[Number(index) >>> 0] ?? null;
	}
	contains(token: string): boolean {
		return this.#tokens().includes(String(token));
	}
	add(...tokens: string[]): void {
		const added = tokens.map(validateToken);
		this.#write([...new Set([...this.#tokens(), ...added])]);
	}
	remove(...tokens: string[]): void {
		const removed = tokens.map(validateToken);
		this.#write(this.#tokens().filter((token) => !removed.includes(token)));
	}
	toggle(token: string, force?: boolean): boolean {
		token = validateToken(token);
		const exists = this.contains(token);
		if (exists && force !== true) {
			this.remove(token);
			return false;
		}
		if (!exists && force !== false) {
			this.add(token);
			return true;
		}
		return exists;
	}
	replace(token: string, replacement: string): boolean {
		token = validateToken(token);
		replacement = validateToken(replacement);
		const tokens = this.#tokens();
		if (!tokens.includes(token)) return false;
		this.#write([...new Set(tokens.map((entry) => (entry === token ? replacement : entry)))]);
		return true;
	}
	supports(_token: string): never {
		// oxlint-disable-next-line bombshell-dev/no-generic-error -- class/for have no supported-token vocabulary in HTML.
		throw new TypeError('This attribute has no supported token vocabulary');
	}
	[Symbol.iterator](): IterableIterator<string> {
		return this.values();
	}
	*values(): IterableIterator<string> {
		for (let index = 0; index < this.length; index++) yield this.item(index)!;
	}
	*keys(): IterableIterator<number> {
		for (let index = 0; index < this.length; index++) yield index;
	}
	*entries(): IterableIterator<[number, string]> {
		for (let index = 0; index < this.length; index++) yield [index, this.item(index)!];
	}
	forEach(
		callback: (value: string, key: number, list: DOMTokenList) => void,
		thisArg?: unknown,
	): void {
		for (let index = 0; index < this.length; index++)
			callback.call(thisArg, this.item(index)!, index, this);
	}
	toString(): string {
		return this.value;
	}
	#tokens(): string[] {
		return [...new Set(this.value.split(/[\t\n\f\r ]+/).filter(Boolean))];
	}
	#write(tokens: readonly string[]): void {
		if (!tokens.length && !this.#element.hasAttribute(this.#attribute)) return;
		this.value = tokens.join(' ');
	}
}
function validateToken(value: string): string {
	const token = String(value);
	if (!token) throw new DOMException('Token must not be empty', 'SyntaxError');
	if (/[\t\n\f\r ]/.test(token))
		throw new DOMException('Token contains whitespace', 'InvalidCharacterError');
	return token;
}

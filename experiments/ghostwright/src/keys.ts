import { InvalidKeyError } from './errors.ts';
import type { KeyName, KeyPress } from './types.ts';

/**
 * Functional keys the Kitty encoder understands, mapped to their key codes.
 * Shared with the WASM encoder so validation and encoding cannot drift apart.
 */
export const FUNCTIONAL_KEYS: Readonly<Record<string, number>> = Object.freeze({
	Backspace: 53,
	Enter: 58,
	Tab: 64,
	Delete: 68,
	End: 69,
	Home: 71,
	PageDown: 73,
	PageUp: 74,
	ArrowDown: 75,
	ArrowLeft: 76,
	ArrowRight: 77,
	ArrowUp: 78,
	Escape: 120,
});

const MODIFIERS: Readonly<Record<string, keyof Omit<KeyPress, 'key'>>> = Object.freeze({
	shift: 'shift',
	ctrl: 'control',
	control: 'control',
	alt: 'alt',
	option: 'alt',
	cmd: 'super',
	command: 'super',
	meta: 'super',
	super: 'super',
});

/** True when `name` is a key the encoder can actually turn into bytes. */
export function isValidKeyName(name: string): boolean {
	if (name in FUNCTIONAL_KEYS) return true;
	const fn = /^F(\d+)$/.exec(name);
	if (fn) return Number(fn[1]) >= 1 && Number(fn[1]) <= 25;
	return [...name].length === 1;
}

function describeValidKeys(): string {
	return `${Object.keys(FUNCTIONAL_KEYS).join(', ')}, F1-F25, or a single character`;
}

/**
 * Normalize a key argument into a validated {@link KeyPress}.
 *
 * Accepts the combination syntax people reach for first (`'Shift+Tab'`,
 * `'Ctrl+A'`, `'Cmd+K'`) in addition to the object form. Unknown key names are
 * rejected here rather than silently encoding to nothing: `KeyName` widens to
 * `string`, so TypeScript cannot catch a typo, and an unencodable key used to
 * surface only as an assertion timeout much later.
 */
export function parseKey(input: KeyName | KeyPress): KeyPress {
	if (typeof input !== 'string') {
		if (!input || typeof input.key !== 'string')
			throw new InvalidKeyError('Key press requires a string `key` property');
		if (!isValidKeyName(input.key))
			throw new InvalidKeyError(
				`Unknown key ${JSON.stringify(input.key)}. Expected ${describeValidKeys()}.`,
			);
		return input;
	}

	const press: KeyPress = { key: input };
	let rest = input;
	for (;;) {
		// Strip one leading `Modifier+` at a time so `Ctrl++` keeps `+` as the key.
		const match = /^([A-Za-z]+)\+(?=.)/.exec(rest);
		if (!match) break;
		const modifier = MODIFIERS[match[1].toLowerCase()];
		if (!modifier) break;
		press[modifier] = true;
		rest = rest.slice(match[0].length);
	}
	press.key = rest;

	if (!isValidKeyName(press.key))
		throw new InvalidKeyError(
			`Unknown key ${JSON.stringify(input)}. Expected ${describeValidKeys()}, optionally prefixed with Shift+, Ctrl+, Alt+, or Cmd+.`,
		);
	return press;
}

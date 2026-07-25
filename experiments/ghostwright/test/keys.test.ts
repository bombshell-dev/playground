import { expect, test } from 'bun:test';
import { InvalidKeyError, isValidKeyName, parseKey } from '../src/index.ts';

test('parseKey accepts functional key names', () => {
	expect(parseKey('Tab')).toEqual({ key: 'Tab' });
	expect(parseKey('Enter')).toEqual({ key: 'Enter' });
	expect(parseKey('ArrowLeft')).toEqual({ key: 'ArrowLeft' });
});

test('parseKey accepts single characters and function keys', () => {
	expect(parseKey('a')).toEqual({ key: 'a' });
	expect(parseKey('+')).toEqual({ key: '+' });
	expect(parseKey('F12')).toEqual({ key: 'F12' });
});

test('parseKey understands modifier combinations', () => {
	expect(parseKey('Shift+Tab')).toEqual({ key: 'Tab', shift: true });
	expect(parseKey('Ctrl+A')).toEqual({ key: 'A', control: true });
	expect(parseKey('Control+A')).toEqual({ key: 'A', control: true });
	expect(parseKey('Alt+x')).toEqual({ key: 'x', alt: true });
	expect(parseKey('Cmd+k')).toEqual({ key: 'k', super: true });
	expect(parseKey('Ctrl+Shift+Home')).toEqual({ key: 'Home', control: true, shift: true });
});

test('parseKey is case insensitive for modifiers only', () => {
	expect(parseKey('shift+Tab')).toEqual({ key: 'Tab', shift: true });
	// The key itself keeps its case, since case is significant for characters.
	expect(parseKey('Shift+a')).toEqual({ key: 'a', shift: true });
});

test('parseKey keeps a trailing plus as the key', () => {
	expect(parseKey('Ctrl++')).toEqual({ key: '+', control: true });
});

test('parseKey rejects unknown key names instead of silently encoding nothing', () => {
	expect(() => parseKey('Retrun')).toThrow(InvalidKeyError);
	expect(() => parseKey('Shift+Nope')).toThrow(InvalidKeyError);
	expect(() => parseKey('F99')).toThrow(InvalidKeyError);
});

test('parseKey error names the valid options', () => {
	try {
		parseKey('Retrun');
		expect.unreachable('should have thrown');
	} catch (error) {
		expect(error).toBeInstanceOf(InvalidKeyError);
		expect((error as InvalidKeyError).code).toBe('GW_INVALID_KEY');
		expect((error as Error).message).toContain('Enter');
		expect((error as Error).message).toContain('single character');
	}
});

test('parseKey passes through and validates the object form', () => {
	expect(parseKey({ key: 'Tab', shift: true })).toEqual({ key: 'Tab', shift: true });
	expect(() => parseKey({ key: 'Nope' })).toThrow(InvalidKeyError);
	expect(() => parseKey({} as never)).toThrow(InvalidKeyError);
});

test('isValidKeyName covers the encodable set', () => {
	expect(isValidKeyName('Tab')).toBe(true);
	expect(isValidKeyName('F1')).toBe(true);
	expect(isValidKeyName('F25')).toBe(true);
	expect(isValidKeyName('F26')).toBe(false);
	expect(isValidKeyName('F0')).toBe(false);
	expect(isValidKeyName('é')).toBe(true);
	expect(isValidKeyName('ab')).toBe(false);
	expect(isValidKeyName('')).toBe(false);
});

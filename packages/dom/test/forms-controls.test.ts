import { describe, expect, it, vi } from 'vitest';
import { Document, type Element, HTMLInputElement } from '../src/dom.ts';
import { Event, MouseEvent } from '../src/events.ts';
import { controlState, isDisabled } from '../src/forms.ts';
import { markControlUserEdited } from '../src/controls.ts';

function fixture(): { document: Document; root: Element } {
	const document = new Document();
	const root = document.createElement('main');
	document.append(root);
	return { document, root };
}

describe('input checkedness and radio groups', () => {
	it('keeps checkedness dirtiness independent of its reflected default', () => {
		const { document } = fixture();
		const input = document.createElement('input');
		input.type = 'checkbox';
		expect(input.checked).toBe(false);
		input.defaultChecked = true;
		expect(input.checked).toBe(true);
		input.checked = false;
		input.defaultChecked = false;
		input.defaultChecked = true;
		expect(input.checked).toBe(false);
		controlState(input)?.reset();
		expect(input.checked).toBe(true);
		input.defaultChecked = false;
		expect(input.checked).toBe(false);
	});

	it('uses before-listener checkbox activation and restores canceled state', () => {
		const { document, root } = fixture();
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.indeterminate = true;
		root.append(input);
		const changes: string[] = [];
		input.addEventListener('input', () => changes.push('input'));
		input.addEventListener('change', () => changes.push('change'));
		input.addEventListener(
			'click',
			(event) => {
				expect(input.checked).toBe(true);
				expect(input.indeterminate).toBe(false);
				event.preventDefault();
			},
			{ once: true },
		);
		input.click();
		expect(input.checked).toBe(false);
		expect(input.indeterminate).toBe(true);
		expect(changes).toEqual([]);
		input.click();
		expect(input.checked).toBe(true);
		expect(input.indeterminate).toBe(false);
		expect(changes).toEqual(['input', 'change']);
		input.dispatchEvent(new Event('click', { cancelable: true }));
		expect(input.checked).toBe(true);
		input.dispatchEvent(new MouseEvent('click'));
		expect(input.checked).toBe(false);
	});

	it('keeps nested canceled activation bookkeeping separate from the outer click', () => {
		const { document, root } = fixture();
		const input = document.createElement('input');
		input.type = 'checkbox';
		root.append(input);
		const change = vi.fn();
		input.addEventListener('change', change);
		input.addEventListener(
			'click',
			() => {
				input.addEventListener('click', (event) => event.preventDefault(), { once: true });
				input.dispatchEvent(new MouseEvent('click', { cancelable: true }));
			},
			{ once: true },
		);
		input.click();
		expect(input.checked).toBe(true);
		expect(change).toHaveBeenCalledOnce();
	});

	it('retains dirty checkedness after cancellation and suppresses detached input/change events', () => {
		const { document } = fixture();
		const input = document.createElement('input');
		input.type = 'checkbox';
		const change = vi.fn();
		input.addEventListener('change', change);
		input.addEventListener('click', (event) => event.preventDefault(), { once: true });
		input.click();
		input.defaultChecked = true;
		expect(input.checked).toBe(false);
		input.click();
		expect(input.checked).toBe(true);
		expect(change).not.toHaveBeenCalled();
	});

	it('follows the current group when rolling back a canceled radio activation', () => {
		const { document, root } = fixture();
		const first = document.createElement('input');
		const second = document.createElement('input');
		for (const radio of [first, second]) {
			radio.type = 'radio';
			radio.name = 'group';
		}
		root.append(first, second);
		first.checked = true;
		second.addEventListener('click', (event) => {
			first.name = 'elsewhere';
			event.preventDefault();
		});
		second.click();
		// WHATWG's legacy-canceled-activation algorithm; Chrome156 currently differs here.
		expect([first.checked, second.checked]).toEqual([false, false]);
	});

	it('groups radios by name, tree, and form ownership including reassociation', () => {
		const { document, root } = fixture();
		const firstForm = document.createElement('form');
		firstForm.id = 'first';
		const secondForm = document.createElement('form');
		secondForm.id = 'second';
		const first = document.createElement('input');
		const second = document.createElement('input');
		const third = document.createElement('input');
		for (const radio of [first, second, third]) {
			radio.type = 'radio';
			radio.name = 'choice';
		}
		firstForm.append(first, second);
		secondForm.append(third);
		root.append(firstForm, secondForm);
		first.checked = true;
		third.checked = true;
		expect(first.checked).toBe(true);
		second.checked = true;
		expect(first.checked).toBe(false);
		expect(third.checked).toBe(true);
		third.setAttribute('form', 'first');
		expect(second.checked).toBe(false);
		expect(third.checked).toBe(true);
		second.name = '';
		second.checked = true;
		expect(third.checked).toBe(true);
	});

	it('preserves dirty checkedness in clones and restores a radio group on cancellation', () => {
		const { document, root } = fixture();
		const first = document.createElement('input');
		first.type = 'radio';
		first.name = 'choice';
		first.defaultChecked = true;
		const second = document.createElement('input');
		second.type = 'radio';
		second.name = 'choice';
		root.append(first, second);
		second.addEventListener('click', (event) => event.preventDefault(), { once: true });
		second.click();
		expect(first.checked).toBe(true);
		expect(second.checked).toBe(false);
		const changes = vi.fn();
		first.addEventListener('change', changes);
		first.click();
		expect(changes).not.toHaveBeenCalled();
		first.checked = false;
		first.indeterminate = true;
		const clone = first.cloneNode();
		if (!(clone instanceof HTMLInputElement)) expect.unreachable();
		expect(clone.defaultChecked).toBe(true);
		expect(clone.checked).toBe(false);
		expect(clone.indeterminate).toBe(true);
		clone.defaultChecked = false;
		clone.defaultChecked = true;
		expect(clone.checked).toBe(false);
	});
});

describe('input value modes, conversion, and stepping', () => {
	it('uses reflected values for checkboxes and buttons and restricts file assignments', () => {
		const { document } = fixture();
		const input = document.createElement('input');
		input.type = 'checkbox';
		expect(input.value).toBe('on');
		input.value = 'yes';
		expect(input.getAttribute('value')).toBe('yes');
		input.type = 'button';
		input.value = 'press';
		expect(input.defaultValue).toBe('press');
		input.type = 'file';
		expect(input.value).toBe('');
		expect(() => {
			input.value = 'secret.txt';
		}).toThrowError(/only be cleared/);
		input.value = '';
	});

	it.each([
		['number', '1\n2', ''],
		['number', ' 3 ', ''],
		['number', 'Infinity', ''],
		['number', '1e2', '1e2'],
		['date', '2025-02-29', ''],
		['date', '2024-02-29', '2024-02-29'],
		['month', '2024-13', ''],
		['week', '2021-W53', ''],
		['week', '2020-W53', '2020-W53'],
		['time', '24:00', ''],
		['time', '12:34:56.78', '12:34:56.78'],
		['datetime-local', '2024-03-02 09:30:00', '2024-03-02T09:30'],
		['color', '#AABBCC', '#aabbcc'],
		['color', 'red', '#000000'],
		['url', ' \thttps://example.com/ \n', 'https://example.com/'],
	])('sanitizes %s value %s', (type, value, expected) => {
		const { document } = fixture();
		const input = document.createElement('input');
		input.type = type;
		input.value = value;
		expect(input.value).toBe(expected);
	});

	it('normalizes email lists and resets value dirtiness', () => {
		const { document } = fixture();
		const input = document.createElement('input');
		input.type = 'email';
		input.multiple = true;
		input.value = ' a@example.com, b@example.com ';
		expect(input.value).toBe('a@example.com,b@example.com');
		input.defaultValue = 'default@example.com';
		expect(input.value).toBe('a@example.com,b@example.com');
		controlState(input)?.reset();
		expect(input.value).toBe('default@example.com');
		input.defaultValue = 'next@example.com';
		expect(input.value).toBe('next@example.com');
	});

	it('converts dates and months in UTC and rejects unsupported conversion', () => {
		const { document } = fixture();
		const input = document.createElement('input');
		input.type = 'date';
		input.value = '2024-02-29';
		expect(input.valueAsNumber).toBe(Date.UTC(2024, 1, 29));
		expect(input.valueAsDate?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
		input.valueAsDate = new Date('2025-05-06T19:40:00Z');
		expect(input.value).toBe('2025-05-06');
		input.type = 'month';
		input.value = '1969-12';
		expect(input.valueAsNumber).toBe(-1);
		expect(input.valueAsDate?.toISOString()).toBe('1969-12-01T00:00:00.000Z');
		input.valueAsNumber = 0;
		expect(input.value).toBe('1970-01');
		input.type = 'datetime-local';
		input.value = '2024-01-02T03:04';
		expect(input.valueAsDate).toBe(null);
		expect(() => {
			input.valueAsDate = null;
		}).toThrowError(/does not support dates/);
		input.type = 'text';
		expect(Number.isNaN(input.valueAsNumber)).toBe(true);
		expect(() => {
			input.valueAsNumber = 1;
		}).toThrowError(/does not support numeric/);
	});

	it('steps numbers and dates using the minimum, base, bounds, and default scale', () => {
		const { document } = fixture();
		const input = document.createElement('input');
		input.type = 'number';
		input.min = '0.1';
		input.max = '1';
		input.step = '0.2';
		input.value = '0.2';
		input.stepUp();
		expect(input.value).toBe('0.3');
		input.stepUp(10);
		expect(input.value).toBe('0.9');
		input.stepDown(2);
		expect(input.value).toBe('0.5');
		input.step = 'any';
		expect(() => input.stepUp()).toThrowError(/step=any/);
		input.type = 'date';
		input.min = '';
		input.max = '';
		input.step = '';
		input.value = '2024-02-28';
		input.stepUp(2);
		expect(input.value).toBe('2024-03-01');
	});

	it('uses Monday-based week conversions and minute-based time steps', () => {
		const { document } = fixture();
		const input = document.createElement('input');
		input.type = 'week';
		input.value = '2020-W53';
		expect(input.valueAsDate?.toISOString()).toBe('2020-12-28T00:00:00.000Z');
		input.stepUp();
		expect(input.value).toBe('2021-W01');
		input.type = 'time';
		input.value = '12:30:30';
		input.stepUp();
		expect(input.value).toBe('12:31');
		input.step = '0.001';
		input.value = '12:31:00.001';
		input.stepDown();
		expect(input.value).toBe('12:31');
		input.min = '22:00';
		input.max = '02:00';
		input.value = '12:00';
		expect(input.validity.rangeUnderflow).toBe(true);
		expect(input.validity.rangeOverflow).toBe(true);
		input.value = '23:00';
		expect(input.validity.rangeUnderflow).toBe(false);
	});

	it('starts the caret at zero when an input becomes text-selectable', () => {
		const { document } = fixture();
		const input = document.createElement('input');
		input.value = 'hello@example.com';
		input.type = 'email';
		input.type = 'text';
		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe(0);
	});

	it('handles invalid numeric constraints and input-type value-mode transitions', () => {
		const { document } = fixture();
		const input = document.createElement('input');
		input.value = 'edited';
		input.type = 'checkbox';
		expect(input.defaultValue).toBe('edited');
		input.type = 'number';
		expect(input.value).toBe('');
		input.min = 'invalid';
		input.max = 'invalid';
		input.step = '0';
		input.value = '2';
		input.stepUp();
		expect(input.value).toBe('3');
		input.valueAsNumber = NaN;
		expect(input.value).toBe('');
		expect(() => {
			input.valueAsNumber = Infinity;
		}).toThrow(TypeError);
		input.type = 'unrecognized';
		expect(input.type).toBe('text');
		expect(() => input.stepUp()).toThrowError(/cannot step/);
	});

	it('sanitizes range defaults, bounds, and step alignment', () => {
		const { document } = fixture();
		const input = document.createElement('input');
		input.type = 'range';
		expect(input.value).toBe('50');
		input.min = '10';
		input.max = '20';
		input.step = '3';
		input.value = '12';
		expect(input.value).toBe('13');
		input.value = '99';
		expect(input.value).toBe('19');
	});
});

describe('form association, labels, disabledness, and constraints', () => {
	it('resolves explicit owners dynamically, including detached ancestor fallback', () => {
		const { document, root } = fixture();
		const form = document.createElement('form');
		form.id = 'owner';
		const input = document.createElement('input');
		input.setAttribute('form', 'owner');
		root.append(input, form);
		expect(input.form).toBe(form);
		form.id = 'other';
		expect(input.form).toBe(null);
		form.append(input);
		form.remove();
		expect(input.form).toBe(form);
		const impostor = document.createElement('div');
		impostor.id = 'owner';
		form.id = 'owner';
		root.append(impostor, form);
		expect(input.form).toBe(null);
	});

	it('exposes live labels and first-legend disabled-fieldset exceptions', () => {
		const { document, root } = fixture();
		const fieldset = document.createElement('fieldset');
		fieldset.disabled = true;
		const legend = document.createElement('legend');
		const input = document.createElement('input');
		input.id = 'field';
		const other = document.createElement('input');
		legend.append(input);
		fieldset.append(legend, other);
		root.append(fieldset);
		expect(isDisabled(input)).toBe(false);
		expect(isDisabled(other)).toBe(true);
		const labels = input.labels;
		const label = document.createElement('label');
		label.htmlFor = 'field';
		root.append(label);
		expect(labels).toEqual([label]);
		label.htmlFor = 'different';
		expect(labels).toHaveLength(0);
		input.type = 'hidden';
		expect(input.labels).toBe(null);
	});

	it('exposes live validity, custom errors, invalid events, and validation eligibility', () => {
		const { document, root } = fixture();
		const input = document.createElement('input');
		input.required = true;
		root.append(input);
		const validity = input.validity;
		expect(validity.valueMissing).toBe(true);
		const invalid = vi.fn((event: Event) => {
			expect(event.bubbles).toBe(false);
			event.preventDefault();
		});
		input.addEventListener('invalid', invalid);
		expect(input.checkValidity()).toBe(false);
		expect(invalid).toHaveBeenCalledOnce();
		input.value = 'okay';
		expect(validity.valid).toBe(true);
		input.setCustomValidity('Application constraint');
		expect(input.validationMessage).toBe('Application constraint');
		expect(validity.customError).toBe(true);
		input.disabled = true;
		expect(input.willValidate).toBe(false);
		expect(input.validationMessage).toBe('');
		expect(input.checkValidity()).toBe(true);
		input.disabled = false;
		input.setCustomValidity('');
		input.readOnly = true;
		expect(input.willValidate).toBe(false);
		input.type = 'checkbox';
		expect(input.willValidate).toBe(true);
	});

	it('invalidates connected validation state independently of attribute mutations', () => {
		const onInvalidate = vi.fn();
		const document = new Document({ onInvalidate });
		const input = document.createElement('input');
		document.append(input);
		onInvalidate.mockClear();
		input.setCustomValidity('Invalid');
		expect(onInvalidate).toHaveBeenCalledWith({ kind: 'mutation', target: input });
		onInvalidate.mockClear();
		input.setCustomValidity('Invalid');
		expect(onInvalidate).not.toHaveBeenCalled();
		input.remove();
		onInvalidate.mockClear();
		input.setCustomValidity('Different');
		expect(onInvalidate).not.toHaveBeenCalled();
	});

	it('validates email, patterns, numeric bounds and steps, and radio requirements', () => {
		const { document, root } = fixture();
		const input = document.createElement('input');
		input.type = 'email';
		input.value = 'invalid';
		expect(input.validity.typeMismatch).toBe(true);
		input.value = 'person@example.com';
		input.pattern = '.+@example\\.org';
		expect(input.validity.patternMismatch).toBe(true);
		input.pattern = '[';
		expect(input.validity.patternMismatch).toBe(false);
		input.type = 'number';
		input.min = '5';
		input.max = '10';
		input.step = '2';
		input.value = '12';
		expect(input.validity.rangeOverflow).toBe(true);
		expect(input.validity.stepMismatch).toBe(true);
		const first = document.createElement('input');
		const second = document.createElement('input');
		for (const radio of [first, second]) {
			radio.type = 'radio';
			radio.name = 'group';
		}
		first.required = true;
		root.append(first, second);
		expect(second.validity.valueMissing).toBe(true);
		second.checked = true;
		expect(first.validity.valueMissing).toBe(false);
	});

	it('applies text length constraints to user edits, preserving UTF-16 lengths', () => {
		const { document } = fixture();
		const textarea = document.createElement('textarea');
		textarea.maxLength = 2;
		textarea.value = '😀a';
		expect(textarea.textLength).toBe(3);
		expect(textarea.validity.tooLong).toBe(false);
		markControlUserEdited(textarea);
		expect(textarea.validity.tooLong).toBe(true);
		textarea.defaultValue = 'reset';
		controlState(textarea)?.reset();
		expect(textarea.value).toBe('reset');
		expect(textarea.validity.tooLong).toBe(false);
		expect(() => {
			textarea.maxLength = -1;
		}).toThrowError(/negative/);
	});
});

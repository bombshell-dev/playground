import { describe, expect, it, vi } from 'vitest';
import {
	Document,
	HTMLDataListElement,
	HTMLMeterElement,
	HTMLOptionElement,
	HTMLProgressElement,
	HTMLSelectElement,
} from '../src/dom.ts';
import { Event } from '../src/events.ts';
import { controlState } from '../src/forms.ts';
import { changeSelectSelection, handleSelectKey } from '../src/value-elements.ts';

function fixture(): {
	document: Document;
	select: HTMLSelectElement;
	options: HTMLOptionElement[];
} {
	const document = new Document();
	const select = document.createElement('select');
	const options = ['a', 'b', 'c'].map((value) => {
		const option = document.createElement('option');
		option.value = value;
		option.text = value.toUpperCase();
		return option;
	});
	select.append(...options);
	return { document, select, options };
}

describe('selects and options', () => {
	it('constructs specialized elements and keeps collections live and protected', () => {
		const { document, select, options } = fixture();
		expect(select).toBeInstanceOf(HTMLSelectElement);
		expect(options[0]).toBeInstanceOf(HTMLOptionElement);
		const collection = select.options;
		const selected = select.selectedOptions;
		expect(select.value).toBe('a');
		expect(selected).toEqual([options[0]]);
		const fourth = document.createElement('option');
		fourth.id = 'fourth';
		fourth.value = 'd';
		select.append(fourth);
		expect(collection).toHaveLength(4);
		expect(select.item(3)).toBe(fourth);
		expect(select.item(-1)).toBeNull();
		expect(select.namedItem('fourth')).toBe(fourth);
		expect(select.namedItem('')).toBeNull();
		expect(Reflect.set(collection, 0, fourth)).toBe(false);
		expect(Reflect.deleteProperty(collection, '0')).toBe(false);
		select.value = 'd';
		expect(selected).toEqual([fourth]);
		expect(select.options[0]).toBe(options[0]);
	});

	it('keeps selectedness separate from selected attributes and resets dirty options', () => {
		const { select, options } = fixture();
		const [first, second, third] = options;
		if (!first || !second || !third) expect.unreachable();
		second.defaultSelected = true;
		expect(select.selectedIndex).toBe(1);
		third.selected = true;
		expect(select.value).toBe('c');
		expect(second.defaultSelected).toBe(true);
		third.defaultSelected = true;
		third.defaultSelected = false;
		expect(third.selected).toBe(true);
		controlState(select)?.reset();
		expect(select.value).toBe('b');
		third.defaultSelected = true;
		expect(select.value).toBe('c');
	});

	it('supports explicit empty selection and duplicate values without firing change on assignments', () => {
		const { select, options } = fixture();
		const listener = vi.fn();
		select.addEventListener('input', listener);
		select.addEventListener('change', listener);
		select.value = 'absent';
		expect(select.selectedIndex).toBe(-1);
		expect(select.selectedOptions).toHaveLength(0);
		select.selectedIndex = 2;
		expect(select.value).toBe('c');
		const second = options[1];
		if (!second) expect.unreachable();
		second.value = 'a';
		select.value = 'a';
		expect(select.selectedIndex).toBe(0);
		select.selectedIndex = 100;
		expect(select.value).toBe('');
		expect(listener).not.toHaveBeenCalled();
	});

	it('does not change selectedness when an existing selected attribute changes value', () => {
		const { select, options } = fixture();
		const [first, second] = options;
		if (!first || !second) expect.unreachable();
		first.setAttribute('selected', '');
		second.selected = true;
		first.setAttribute('selected', 'changed');
		expect(select.selectedIndex).toBe(1);
		first.removeAttribute('selected');
		first.setAttribute('selected', '');
		expect(select.selectedIndex).toBe(0);
	});

	it('follows the HTML reset algorithm even for an unchanged false option setter', () => {
		const { select, options } = fixture();
		select.value = 'missing';
		expect(select.selectedIndex).toBe(-1);
		const first = options[0];
		if (!first) expect.unreachable();
		first.selected = false;
		// Chrome 156 skips its reset for this no-op setter; the current standard does not.
		expect(select.selectedIndex).toBe(0);
	});

	it('updates single selection when selected options are inserted, removed, and moved', () => {
		const { document, select, options } = fixture();
		const other = document.createElement('select');
		const option = document.createElement('option');
		option.value = 'incoming';
		option.selected = true;
		select.insertBefore(option, options[0] ?? null);
		expect(select.value).toBe('incoming');
		expect(select.selectedOptions).toEqual([option]);
		other.append(option);
		expect(select.value).toBe('a');
		expect(other.value).toBe('incoming');
		select.selectedIndex = 2;
		select.remove(2);
		expect(select.value).toBe('a');
		select.remove(100);
		expect(select.length).toBe(2);
	});

	it('supports multiple, size, collection mutations and a null anchor', () => {
		const { document, select, options } = fixture();
		select.multiple = true;
		const second = options[1];
		if (!second) expect.unreachable();
		second.selected = true;
		expect(select.type).toBe('select-multiple');
		expect(select.selectedOptions).toHaveLength(2);
		select.multiple = false;
		expect(select.selectedIndex).toBe(1);
		select.length = 5;
		expect(select.length).toBe(5);
		expect(select.options[4]).toBeInstanceOf(HTMLOptionElement);
		select.length = 1;
		expect(select.selectedIndex).toBe(0);
		const listbox = document.createElement('select');
		listbox.size = 3;
		listbox.add(document.createElement('option'), null);
		expect(listbox.selectedIndex).toBe(-1);
		listbox.size = 1;
		expect(listbox.selectedIndex).toBe(0);
		const foreign = document.createElement('option');
		expect(() => listbox.add(foreign, select)).toThrow();
		expect(foreign.parentNode).toBeNull();
		document.append(listbox);
		listbox.remove();
		expect(document.documentElement).toBeNull();
	});

	it('collects options in tree order without crossing datalists or nested selects', () => {
		const { document, select } = fixture();
		const group = document.createElement('optgroup');
		const wrapper = document.createElement('box');
		const grouped = document.createElement('option');
		grouped.value = 'grouped';
		wrapper.append(grouped);
		group.append(wrapper);
		select.append(group);
		const nested = document.createElement('select');
		nested.append(document.createElement('option'));
		const datalist = document.createElement('datalist');
		datalist.append(document.createElement('option'));
		const nestedGroup = document.createElement('optgroup');
		nestedGroup.append(document.createElement('option'));
		group.append(nestedGroup);
		select.append(nested, datalist);
		expect(select.options).toHaveLength(4);
		expect(grouped.index).toBe(3);
	});

	it('collapses option text using ASCII whitespace and ignores script text', () => {
		const document = new Document();
		const option = document.createElement('option');
		option.append('  one\n\t');
		const span = document.createElement('span');
		span.textContent = ' two\u00a0three  ';
		const script = document.createElement('script');
		script.textContent = 'excluded';
		option.append(span, script);
		expect(option.text).toBe('one two\u00a0three');
		expect(option.value).toBe(option.text);
		option.value = '';
		expect(option.value).toBe('');
		option.label = 'Label';
		expect(option.label).toBe('Label');
		expect(option.text).toBe('one two\u00a0three');
		option.label = '';
		expect(option.label).toBe('');
	});

	it('skips disabled options and groups for defaults and host input', () => {
		const document = new Document();
		const select = document.createElement('select');
		const group = document.createElement('optgroup');
		group.disabled = true;
		const blocked = document.createElement('option');
		blocked.value = 'blocked';
		group.append(blocked);
		const allowed = document.createElement('option');
		allowed.value = 'allowed';
		select.append(group, allowed);
		expect(select.value).toBe('allowed');
		expect(changeSelectSelection(select, [0])).toBe(false);
		expect(select.value).toBe('allowed');
		blocked.selected = true;
		expect(select.value).toBe('blocked');
		select.disabled = true;
		expect(changeSelectSelection(select, [1])).toBe(false);
		expect(select.value).toBe('blocked');
	});

	it('host selection dispatches distinct input/change only for a changed value', () => {
		const { select } = fixture();
		const received: string[] = [];
		select.addEventListener('input', (event) => {
			received.push(`${event.type}:${select.value}:${event.isTrusted}:${event.composed}`);
		});
		select.addEventListener('change', (event) =>
			received.push(`${event.type}:${select.value}:${event.composed}`),
		);
		expect(changeSelectSelection(select, [1])).toBe(true);
		expect(changeSelectSelection(select, [1])).toBe(false);
		expect(received).toEqual(['input:b:false:true', 'change:b:false']);
		select.dispatchEvent(new Event('keydown'));
		expect(select.value).toBe('b');
		expect(handleSelectKey(select, 'End')).toBe(true);
		expect(select.value).toBe('c');
		expect(handleSelectKey(select, 'Home')).toBe(true);
		expect(select.value).toBe('a');
	});

	it('invalidates connected selection changes without pretending they are attribute mutations', () => {
		const invalidated = vi.fn();
		const document = new Document({ onInvalidate: invalidated });
		const select = document.createElement('select');
		const first = document.createElement('option');
		const second = document.createElement('option');
		select.append(first, second);
		select.selectedIndex = 1;
		expect(invalidated).not.toHaveBeenCalled();
		document.append(select);
		invalidated.mockClear();
		select.selectedIndex = 0;
		expect(invalidated).toHaveBeenCalled();
		expect(first.hasAttribute('selected')).toBe(false);
		select.remove();
		invalidated.mockClear();
		select.selectedIndex = 1;
		expect(invalidated).not.toHaveBeenCalled();
	});

	it('keeps dirty selectedness when options are cloned or imported', () => {
		const { document, select, options } = fixture();
		const second = options[1];
		if (!second) expect.unreachable();
		second.selected = true;
		const copy = new Document().importNode(select, true);
		if (!(copy instanceof HTMLSelectElement)) expect.unreachable();
		expect(copy.value).toBe('b');
		const optionCopy = copy.options[1];
		if (!optionCopy) expect.unreachable();
		optionCopy.defaultSelected = true;
		optionCopy.defaultSelected = false;
		expect(optionCopy.selected).toBe(true);
		expect(optionCopy.ownerDocument).not.toBe(document);
		select.selectedIndex = -1;
		const emptyCopy = select.cloneNode(true);
		if (!(emptyCopy instanceof HTMLSelectElement)) expect.unreachable();
		expect(emptyCopy.selectedIndex).toBe(-1);
	});
});

describe('form values, suggestions, and selected content', () => {
	it('associates select/option/output with forms and validates placeholder selections', () => {
		const document = new Document();
		const form = document.createElement('form');
		const select = document.createElement('select');
		select.name = 'choice';
		select.required = true;
		const placeholder = document.createElement('option');
		placeholder.value = '';
		placeholder.text = 'Choose';
		const option = document.createElement('option');
		option.value = 'yes';
		select.append(placeholder, option);
		const output = document.createElement('output');
		form.append(select, output);
		expect(select.form).toBe(form);
		expect(option.form).toBe(form);
		expect(output.form).toBe(form);
		expect(select.validity.valueMissing).toBe(true);
		expect(select.checkValidity()).toBe(false);
		select.value = 'yes';
		expect(select.checkValidity()).toBe(true);
		expect(controlState(select)?.entries()).toEqual([['choice', 'yes']]);
		expect(controlState(output)?.entries()).toEqual([]);
		select.setCustomValidity('Unavailable');
		expect(select.validationMessage).toBe('Unavailable');
		expect(select.checkValidity()).toBe(false);
		select.disabled = true;
		expect(select.willValidate).toBe(false);
		expect(select.checkValidity()).toBe(true);
	});

	it('multiple selection submits only selected enabled options', () => {
		const { select, options } = fixture();
		select.name = 'value';
		select.multiple = true;
		for (const option of options) option.selected = true;
		const second = options[1];
		if (!second) expect.unreachable();
		second.disabled = true;
		expect(controlState(select)?.entries()).toEqual([
			['value', 'a'],
			['value', 'c'],
		]);
	});

	it('exposes live datalist options independently of selection', () => {
		const document = new Document();
		const datalist = document.createElement('datalist');
		expect(datalist).toBeInstanceOf(HTMLDataListElement);
		const options = datalist.options;
		const option = document.createElement('option');
		datalist.append(option);
		expect(options).toEqual([option]);
		expect(option.selected).toBe(false);
		option.remove();
		expect(options).toHaveLength(0);
	});

	it('retains output defaults across computed values and resets to default mode', () => {
		const document = new Document();
		const output = document.createElement('output');
		output.textContent = 'initial';
		expect(output.defaultValue).toBe('initial');
		output.value = 'computed';
		expect(output.defaultValue).toBe('initial');
		output.defaultValue = 'new default';
		expect(output.value).toBe('computed');
		controlState(output)?.reset();
		expect(output.value).toBe('new default');
		output.textContent = 'pristine';
		expect(output.defaultValue).toBe('pristine');
		expect(output.willValidate).toBe(false);
		const tokens = output.htmlFor;
		output.htmlFor = 'first second';
		expect(output.htmlFor).toBe(tokens);
		expect([...tokens]).toEqual(['first', 'second']);
		tokens.add('third');
		expect(output.getAttribute('for')).toBe('first second third');
	});

	it('snapshots selected option contents until reselected and clears an empty selection', () => {
		const { document, select, options } = fixture();
		const button = document.createElement('button');
		const content = document.createElement('selectedcontent');
		button.append(content);
		select.prepend(button);
		expect(content.textContent).toBe('A');
		expect(content.firstChild).not.toBe(options[0]?.firstChild);
		select.value = 'b';
		expect(content.textContent).toBe('B');
		const selected = options[1];
		if (!selected) expect.unreachable();
		selected.text = 'Updated';
		expect(content.textContent).toBe('B');
		select.value = 'b';
		expect(content.textContent).toBe('Updated');
		select.selectedIndex = -1;
		expect(content.childNodes).toHaveLength(0);
	});

	it('does not recursively fill selectedcontent inside options', () => {
		const { document, select, options } = fixture();
		const content = document.createElement('selectedcontent');
		options[0]?.append(content);
		select.selectedIndex = 0;
		expect(content.childNodes).toHaveLength(0);
	});

	it('updates removed selected-option snapshots in a microtask without replacing unrelated mirrors', async () => {
		const { document, select, options } = fixture();
		const first = document.createElement('selectedcontent');
		select.prepend(first);
		const original = first.firstChild;
		const second = document.createElement('selectedcontent');
		select.prepend(second);
		expect(first.firstChild).toBe(original);
		const extra = document.createElement('option');
		extra.text = 'extra';
		select.append(extra);
		expect(first.firstChild).toBe(original);
		options[0]?.remove();
		expect(select.value).toBe('b');
		expect(first.textContent).toBe('A');
		await Promise.resolve();
		expect(first.textContent).toBe('B');
		expect(second.textContent).toBe('B');
	});
});

describe('numeric indicators', () => {
	it('implements determinate and indeterminate progress with clamped getters', () => {
		const document = new Document();
		const progress = document.createElement('progress');
		expect(progress).toBeInstanceOf(HTMLProgressElement);
		expect(progress.position).toBe(-1);
		expect(progress.value).toBe(0);
		expect(progress.max).toBe(1);
		progress.max = 10;
		progress.value = 5;
		expect(progress.position).toBe(0.5);
		progress.value = 20;
		expect(progress.value).toBe(10);
		expect(progress.getAttribute('value')).toBe('20');
		progress.max = 0;
		expect(progress.max).toBe(10);
		progress.setAttribute('max', '0');
		expect(progress.max).toBe(1);
		progress.value = -1;
		expect(progress.value).toBe(0);
		progress.removeAttribute('value');
		expect(progress.position).toBe(-1);
		expect(() => {
			progress.value = Number.NaN;
		}).toThrow(TypeError);
	});

	it('derives meter bounds in order and retains raw reflected attributes', () => {
		const document = new Document();
		const meter = document.createElement('meter');
		expect(meter).toBeInstanceOf(HTMLMeterElement);
		expect([meter.min, meter.max, meter.value, meter.low, meter.high, meter.optimum]).toEqual([
			0, 1, 0, 0, 1, 0.5,
		]);
		meter.min = 10;
		meter.max = 20;
		meter.value = 100;
		meter.low = 15;
		meter.high = 12;
		meter.optimum = -5;
		expect([meter.value, meter.low, meter.high, meter.optimum]).toEqual([20, 15, 15, 10]);
		expect(meter.getAttribute('value')).toBe('100');
		meter.max = -1;
		expect(meter.max).toBe(10);
		meter.setAttribute('min', 'invalid');
		expect(meter.min).toBe(0);
		meter.setAttribute('max', '2.5 trailing');
		expect(meter.max).toBe(2.5);
		expect(() => {
			meter.optimum = Number.POSITIVE_INFINITY;
		}).toThrow(TypeError);
	});
});

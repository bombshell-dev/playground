import { describe, expect, it } from 'vitest';
import {
	Document,
	Event,
	MouseEvent,
	KeyboardEvent,
	SubmitEvent,
	FormData,
	FormDataEvent,
	HTMLFormElement,
	HTMLButtonElement,
	SVG_NAMESPACE,
} from '../src/index.ts';

function fixture(): { document: Document; root: ReturnType<Document['createElement']> } {
	const document = new Document();
	const root = document.createElement('box');
	document.append(root);
	return { document, root };
}

describe('form ownership, activation, and local submission', () => {
	it('excludes datalist buttons from validation and foreign input names from activation', () => {
		const { document, root } = fixture();
		const form = root.appendChild(document.createElement('form'));
		const list = form.appendChild(document.createElement('datalist'));
		const barred = list.appendChild(document.createElement('button'));
		barred.setCustomValidity('barred');
		expect(barred.willValidate).toBe(false);
		expect(form.checkValidity()).toBe(true);
		const button = form.appendChild(document.createElement('button'));
		const foreign = button.appendChild(document.createElementNS(SVG_NAMESPACE, 'input'));
		let submitted = false;
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			submitted = true;
		});
		foreign.click();
		expect(submitted).toBe(true);
	});
	it('uses the activation target in its own shadow scope after event retargeting', () => {
		const { document, root } = fixture();
		const shadow = root.attachShadow({ mode: 'open' });
		const label = shadow.appendChild(document.createElement('label'));
		const input = label.appendChild(document.createElement('input'));
		input.type = 'checkbox';
		const anchor = label.appendChild(document.createElement('a'));
		anchor.setAttribute('href', '#');
		const text = anchor.appendChild(document.createTextNode('link'));
		text.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
		expect(input.checked).toBe(false);
		const details = shadow.appendChild(document.createElement('details'));
		const summary = details.appendChild(document.createElement('summary'));
		summary.append(anchor);
		text.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
		expect(details.open).toBe(false);
		summary.click();
		expect(details.open).toBe(true);
	});
	it('constructs specialized form/button elements and submits a live entry list', () => {
		const { document, root } = fixture();
		const form = document.createElement('form');
		const input = document.createElement('input');
		const button = document.createElement('button');
		input.name = 'answer';
		input.value = '42';
		button.name = 'action';
		button.value = 'save';
		form.append(input, button);
		root.append(form);
		expect(form).toBeInstanceOf(HTMLFormElement);
		expect(button).toBeInstanceOf(HTMLButtonElement);
		const calls: string[] = [];
		form.addEventListener('submit', (event) => {
			expect(event).toBeInstanceOf(SubmitEvent);
			if (event instanceof SubmitEvent) expect(event.submitter).toBe(button);
			input.value = 'updated';
			calls.push('submit');
		});
		form.addEventListener('formdata', (event) => {
			if (!(event instanceof FormDataEvent)) return;
			expect([...event.formData]).toEqual([
				['answer', 'updated'],
				['action', 'save'],
			]);
			calls.push('formdata');
		});
		button.click();
		expect(calls).toEqual(['submit', 'formdata']);
	});
	it('supports external ownership and reassociation after id changes or moves', () => {
		const { document, root } = fixture();
		const first = document.createElement('form');
		first.id = 'a';
		const second = document.createElement('form');
		second.id = 'b';
		const input = document.createElement('input');
		input.setAttribute('form', 'a');
		root.append(first, second, input);
		const collection = first.elements;
		expect(input.form).toBe(first);
		expect([...collection]).toEqual([input]);
		input.setAttribute('form', 'b');
		expect(input.form).toBe(second);
		expect(collection.length).toBe(0);
		second.id = 'c';
		expect(input.form).toBeNull();
		input.removeAttribute('form');
		first.append(input);
		expect(input.form).toBe(first);
	});
	it('validates all controls, honors cancellation and novalidate, and exposes custom messages', () => {
		const { document, root } = fixture();
		const form = document.createElement('form');
		const input = document.createElement('input');
		input.name = 'name';
		input.required = true;
		form.append(input);
		root.append(form);
		let invalid = 0;
		let submissions = 0;
		let entries = 0;
		input.addEventListener('invalid', () => invalid++);
		form.addEventListener('submit', () => submissions++);
		form.addEventListener('formdata', () => entries++);
		form.requestSubmit();
		expect(invalid).toBe(1);
		expect(submissions).toBe(0);
		input.value = 'ready';
		input.setCustomValidity('Try again');
		expect(input.validationMessage).toBe('Try again');
		expect(form.checkValidity()).toBe(false);
		form.noValidate = true;
		form.requestSubmit();
		expect(submissions).toBe(1);
		form.addEventListener('submit', (event) => event.preventDefault());
		form.requestSubmit();
		expect(entries).toBe(1);
	});
	it('reset is cancelable and restores dirty values, checkedness, selections, and output defaults', () => {
		const { document, root } = fixture();
		const form = document.createElement('form');
		const input = document.createElement('input');
		input.defaultValue = 'original';
		input.value = 'changed';
		const check = document.createElement('input');
		check.type = 'checkbox';
		check.defaultChecked = true;
		check.checked = false;
		const select = document.createElement('select');
		const a = document.createElement('option');
		a.value = 'a';
		const b = document.createElement('option');
		b.value = 'b';
		select.append(a, b);
		select.value = 'b';
		const output = document.createElement('output');
		output.defaultValue = '0';
		output.value = '99';
		form.append(input, check, select, output);
		root.append(form);
		form.addEventListener('reset', (event) => event.preventDefault(), { once: true });
		form.reset();
		expect(input.value).toBe('changed');
		form.reset();
		expect(input.value).toBe('original');
		expect(check.checked).toBe(true);
		expect(select.value).toBe('a');
		expect(output.value).toBe('0');
		input.defaultValue = 'new';
		expect(input.value).toBe('new');
	});
	it('omits disabled and unnamed controls, includes selected values and unchecked defaults correctly', () => {
		const { document, root } = fixture();
		const form = document.createElement('form');
		root.append(form);
		const fieldset = document.createElement('fieldset');
		fieldset.disabled = true;
		const legend = document.createElement('legend');
		const included = document.createElement('input');
		included.name = 'legend';
		included.value = 'yes';
		legend.append(included);
		const excluded = document.createElement('input');
		excluded.name = 'disabled';
		fieldset.append(legend, excluded);
		form.append(fieldset);
		const check = document.createElement('input');
		check.type = 'checkbox';
		check.name = 'check';
		form.append(check);
		const select = document.createElement('select');
		select.multiple = true;
		select.name = 'items';
		for (const value of ['a', 'b']) {
			const option = document.createElement('option');
			option.value = value;
			option.selected = true;
			select.append(option);
		}
		form.append(select);
		expect([...new FormData(form)]).toEqual([
			['legend', 'yes'],
			['items', 'a'],
			['items', 'b'],
		]);
		check.checked = true;
		expect(new FormData(form).get('check')).toBe('on');
	});
	it('requestSubmit rejects invalid submitters while submit bypasses validation/submit listeners', () => {
		const { document, root } = fixture();
		const form = document.createElement('form');
		root.append(form);
		const input = document.createElement('input');
		input.required = true;
		input.name = 'required';
		form.append(input);
		const other = document.createElement('button');
		root.append(other);
		expect(() => form.requestSubmit(input)).toThrow(TypeError);
		expect(() => form.requestSubmit(other)).toThrow('Submitter belongs');
		let submits = 0;
		let data = 0;
		form.addEventListener('submit', () => submits++);
		form.addEventListener('formdata', () => data++);
		form.submit();
		expect(submits).toBe(0);
		expect(data).toBe(1);
	});
	it('label activation resolves explicit and nested controls without double activation', () => {
		const { document, root } = fixture();
		const label = document.createElement('label');
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.id = 'agree';
		label.htmlFor = 'agree';
		root.append(label, input);
		label.click();
		expect(input.checked).toBe(true);
		expect(document.activeElement).toBe(input);
		label.removeAttribute('for');
		label.append(input);
		input.click();
		expect(input.checked).toBe(false);
		const span = document.createElement('span');
		label.append(span);
		span.click();
		expect(input.checked).toBe(true);
	});
	it('captures an ancestor activation target and preactivation before listeners, and rolls back cancellation', () => {
		const { document, root } = fixture();
		const form = document.createElement('form');
		const button = document.createElement('button');
		const child = document.createElement('span');
		button.append(child);
		form.append(button);
		root.append(form);
		let submitted = 0;
		form.addEventListener('submit', () => submitted++);
		child.click();
		expect(submitted).toBe(1);
		const check = document.createElement('input');
		check.type = 'checkbox';
		root.append(check);
		check.indeterminate = true;
		check.addEventListener('click', (event) => {
			expect(check.checked).toBe(true);
			expect(check.indeterminate).toBe(false);
			event.preventDefault();
		});
		expect(check.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(
			false,
		);
		expect(check.checked).toBe(false);
		expect(check.indeterminate).toBe(true);
	});
	it('plain events and synthetic keyboard dispatch do not perform activation', () => {
		const { document, root } = fixture();
		const check = document.createElement('input');
		check.type = 'checkbox';
		root.append(check);
		check.dispatchEvent(new Event('click', { bubbles: true }));
		check.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
		check.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
		expect(check.checked).toBe(false);
	});
	it('method=dialog submits then closes its owning dialog with the submitter value', () => {
		const { document, root } = fixture();
		const dialog = document.createElement('dialog');
		const form = document.createElement('form');
		form.method = 'dialog';
		const button = document.createElement('button');
		button.value = 'accepted';
		form.append(button);
		dialog.append(form);
		root.append(dialog);
		dialog.showModal();
		button.click();
		expect(dialog.open).toBe(false);
		expect(dialog.returnValue).toBe('accepted');
	});

	it('guards entry construction against recursive formdata and releases the guard afterward', () => {
		const { document, root } = fixture();
		const form = document.createElement('form');
		root.append(form);
		let calls = 0;
		form.addEventListener('formdata', () => calls++);
		form.addEventListener(
			'formdata',
			() => {
				expect(() => new FormData(form)).toThrow('already being constructed');
				form.requestSubmit();
				form.submit();
			},
			{ once: true },
		);
		expect(new FormData(form).get('missing')).toBe(null);
		expect(calls).toBe(1);
		expect(new FormData(form).get('missing')).toBe(null);
		expect(calls).toBe(2);
	});

	it('clones the customized entry list after formdata dispatch', () => {
		const { document, root } = fixture();
		const form = document.createElement('form');
		root.append(form);
		const retained: globalThis.FormData[] = [];
		form.addEventListener('formdata', (event) => {
			if (!(event instanceof FormDataEvent)) return;
			event.formData.append('custom', 'during');
			retained.push(event.formData);
		});
		const data = new FormData(form);
		expect(data.get('custom')).toBe('during');
		expect(retained[0]).toBeInstanceOf(FormData);
		retained[0]?.set('custom', 'after');
		expect(data.get('custom')).toBe('during');
	});

	it('constructs dialog submission data before closing and respects removal during formdata', () => {
		const { document, root } = fixture();
		const dialog = document.createElement('dialog');
		const form = document.createElement('form');
		const button = document.createElement('button');
		form.method = 'dialog';
		form.append(button);
		dialog.append(form);
		root.append(dialog);
		dialog.showModal();
		const calls: string[] = [];
		form.addEventListener('submit', () => calls.push('submit'));
		form.addEventListener('formdata', () => {
			calls.push('formdata');
			expect(dialog.open).toBe(true);
		});
		button.click();
		expect(calls).toEqual(['submit', 'formdata']);
		expect(dialog.open).toBe(false);
		dialog.showModal();
		form.addEventListener('formdata', () => form.remove(), { once: true });
		button.click();
		expect(dialog.open).toBe(true);
	});

	it('keeps live form and fieldset collection identities stable', () => {
		const { document, root } = fixture();
		const form = document.createElement('form');
		const fieldset = document.createElement('fieldset');
		form.append(fieldset);
		root.append(form);
		const controls = form.elements;
		const descendants = fieldset.elements;
		expect(form.elements).toBe(controls);
		expect(fieldset.elements).toBe(descendants);
		const input = document.createElement('input');
		fieldset.append(input);
		expect([...controls]).toEqual([fieldset, input]);
		expect([...descendants]).toEqual([input]);
		expect(Reflect.set(controls, '0', input)).toBe(false);
	});

	it('keeps explicit label lookup consistent with labels, including empty IDs and detached roots', () => {
		const document = new Document();
		const input = document.createElement('input');
		const label = document.createElement('label');
		document.append(input);
		input.append(label);
		label.htmlFor = '';
		expect(label.control).toBe(null);
		expect(input.labels).toHaveLength(0);
		input.id = 'root-control';
		label.htmlFor = 'root-control';
		input.remove();
		expect(label.control).toBe(input);
		expect(input.labels).toEqual([label]);
	});

	it('ignores interactive label descendants even when the event targets their text node', () => {
		const { document, root } = fixture();
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.id = 'check';
		const label = document.createElement('label');
		label.htmlFor = 'check';
		const anchor = document.createElement('a');
		anchor.setAttribute('href', '/');
		const text = document.createTextNode('link');
		anchor.append(text);
		label.append(anchor);
		root.append(input, label);
		text.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(input.checked).toBe(false);
		anchor.removeAttribute('href');
		text.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(input.checked).toBe(true);
	});

	it('rejects foreign-namespace submitters and excludes foreign labelable names', () => {
		const { document, root } = fixture();
		const form = document.createElement('form');
		const foreignButton = document.createElementNS(SVG_NAMESPACE, 'button');
		foreignButton.id = 'foreign';
		const label = document.createElement('label');
		label.htmlFor = 'foreign';
		form.append(foreignButton, label);
		root.append(form);
		expect(label.control).toBe(null);
		expect(() => form.requestSubmit(foreignButton)).toThrow(TypeError);
	});

	it('reports every invalid control before focusing the first uncanceled candidate', () => {
		const { document, root } = fixture();
		const form = document.createElement('form');
		const first = document.createElement('input');
		const second = document.createElement('input');
		first.required = second.required = true;
		form.append(first, second);
		root.append(form);
		const events: string[] = [];
		first.addEventListener('invalid', (event) => {
			events.push('first invalid');
			event.preventDefault();
		});
		second.addEventListener('invalid', () => events.push('second invalid'));
		second.addEventListener('focus', () => events.push('focus'));
		expect(form.reportValidity()).toBe(false);
		expect(events).toEqual(['first invalid', 'second invalid', 'focus']);
		expect(document.activeElement).toBe(second);
	});

	it('permits submit() during submit events while blocking recursive requestSubmit()', () => {
		const { document, root } = fixture();
		const form = document.createElement('form');
		root.append(form);
		const events: string[] = [];
		form.addEventListener('submit', (event) => {
			events.push('submit');
			event.preventDefault();
			form.requestSubmit();
			form.submit();
		});
		form.addEventListener('formdata', () => events.push('formdata'));
		form.requestSubmit();
		expect(events).toEqual(['submit', 'formdata']);
	});
});

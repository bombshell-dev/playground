import { describe, expect, it, vi } from 'vitest';
import {
	Document,
	MutationObserver,
	Range,
	type Element,
	type Node,
	type Text,
} from '../src/index.ts';

function fixture(): {
	document: Document;
	root: Element;
	left: Element;
	middle: Element;
	right: Element;
	first: Text;
	last: Text;
} {
	const document = new Document();
	const root = document.createElement('box');
	const left = document.createElement('left');
	const middle = document.createElement('middle');
	const right = document.createElement('right');
	const first = document.createTextNode('A😀B');
	const last = document.createTextNode('last');
	left.append(first);
	middle.append('middle');
	right.append(last);
	root.append(left, middle, right);
	document.append(root);
	return { document, root, left, middle, right, first, last };
}

function endpoints(range: Range): readonly [Node, number, Node, number] {
	return [range.startContainer, range.startOffset, range.endContainer, range.endOffset];
}

describe('live Range', () => {
	it('starts collapsed at the document and uses UTF-16 offsets', () => {
		const { document, first } = fixture();
		const range = document.createRange();
		expect(endpoints(range)).toEqual([document, 0, document, 0]);
		range.setStart(first, 1);
		range.setEnd(first, 3);
		expect(range.toString()).toBe('😀');
		expect(range.collapsed).toBe(false);
		expect(range.commonAncestorContainer).toBe(first);
	});

	it('counts child boundaries, excludes comment text, and traverses descendants', () => {
		const { document, root, first, last } = fixture();
		root.insertBefore(document.createComment('ignored'), root.firstChild);
		const range = document.createRange();
		range.selectNodeContents(root);
		expect(endpoints(range)).toEqual([root, 0, root, 4]);
		expect(range.toString()).toBe('A😀Bmiddlelast');
		range.setStart(first, 3);
		range.setEnd(last, 2);
		expect(range.toString()).toBe('Bmiddlela');
		expect(range.commonAncestorContainer).toBe(root);
	});

	it('collapses across reversed boundary points and different roots', () => {
		const { document, root, first, last } = fixture();
		const range = document.createRange();
		range.selectNodeContents(root);
		range.setStart(last, 2);
		range.setEnd(first, 1);
		expect(endpoints(range)).toEqual([first, 1, first, 1]);
		const detached = document.createTextNode('detached');
		range.setEnd(detached, 3);
		expect(endpoints(range)).toEqual([detached, 3, detached, 3]);
	});

	it('validates offsets before modifying the range', () => {
		const { document, first } = fixture();
		const range = document.createRange();
		range.selectNodeContents(first);
		for (const offset of [-1, 5]) {
			expect(() => range.setStart(first, offset)).toThrow(
				expect.objectContaining({ name: 'IndexSizeError' }),
			);
			expect(endpoints(range)).toEqual([first, 0, first, 4]);
		}
		expect(() => range.setEndBefore(document)).toThrow(
			expect.objectContaining({ name: 'InvalidNodeTypeError' }),
		);
	});

	it('implements before/after, boundary comparison, and point queries', () => {
		const { document, root, left, middle, right, first } = fixture();
		const range = document.createRange();
		range.setStartAfter(left);
		range.setEndBefore(right);
		expect(endpoints(range)).toEqual([root, 1, root, 2]);
		expect(range.intersectsNode(middle)).toBe(true);
		expect(range.intersectsNode(left)).toBe(false);
		expect(range.comparePoint(first, 1)).toBe(-1);
		expect(range.isPointInRange(root, 1)).toBe(true);
		const clone = range.cloneRange();
		expect(clone.compareBoundaryPoints(Range.START_TO_START, range)).toBe(0);
		expect(clone.compareBoundaryPoints(Range.START_TO_END, range)).toBe(1);
		expect(clone.compareBoundaryPoints(Range.END_TO_START, range)).toBe(-1);
		expect(() => clone.compareBoundaryPoints(9, range)).toThrow(
			expect.objectContaining({ name: 'NotSupportedError' }),
		);
		const detached = document.createTextNode('outside');
		expect(range.isPointInRange(detached, 0)).toBe(false);
		expect(() => range.comparePoint(detached, 0)).toThrow(
			expect.objectContaining({ name: 'WrongDocumentError' }),
		);
	});

	it('updates child offsets only when insertion is before the boundary', () => {
		const { document, root, middle } = fixture();
		const range = document.createRange();
		range.setStart(root, 1);
		range.setEnd(root, 3);
		root.insertBefore(document.createElement('new'), middle);
		expect(endpoints(range)).toEqual([root, 1, root, 4]);
		root.append(document.createElement('end'));
		expect(range.endOffset).toBe(4);
	});

	it('moves boundaries in removed descendants to the former parent position', () => {
		const { document, root, left, first, last } = fixture();
		const range = document.createRange();
		range.setStart(first, 2);
		range.setEnd(last, 2);
		left.remove();
		expect(endpoints(range)).toEqual([root, 0, last, 2]);
		root.remove();
		expect(endpoints(range)).toEqual([document, 0, document, 0]);
	});

	it('does not transport range boundaries when an existing subtree moves', () => {
		const { document, root, left, first } = fixture();
		const range = document.createRange();
		range.selectNodeContents(first);
		root.append(left);
		expect(endpoints(range)).toEqual([root, 0, root, 0]);
	});

	it.each([
		[0, 1, 0, 1],
		[1, 2, 1, 1],
		[2, 3, 1, 1],
		[3, 4, 1, 3],
	])('updates text replacement boundaries %i..%i', (start, end, expectedStart, expectedEnd) => {
		const { document, first } = fixture();
		const range = document.createRange();
		range.setStart(first, start);
		range.setEnd(first, end);
		first.replaceData(1, 2, 'X');
		expect(endpoints(range)).toEqual([first, expectedStart, first, expectedEnd]);
	});

	it('migrates ranges during splitText, preserving an offset exactly at the split', () => {
		const { document, first, left } = fixture();
		const range = document.createRange();
		range.setStart(first, 1);
		range.setEnd(first, 4);
		const after = document.createRange();
		after.setStart(left, 1);
		const split = first.splitText(1);
		expect(endpoints(range)).toEqual([first, 1, split, 3]);
		expect(endpoints(after)).toEqual([left, 2, left, 2]);
	});

	it('clones partial ancestor shells without mutating the original', () => {
		const { document, root, first, last } = fixture();
		const range = document.createRange();
		range.setStart(first, 3);
		range.setEnd(last, 2);
		const fragment = range.cloneContents();
		expect(fragment.textContent).toBe('Bmiddlela');
		expect(fragment.children.map((child) => child.localName)).toEqual(['left', 'middle', 'right']);
		expect(root.textContent).toBe('A😀Bmiddlelast');
		expect(fragment.firstChild).not.toBe(root.firstChild);
	});

	it('extracts fully contained nodes by identity and clones partial ancestors', () => {
		const { document, root, left, middle, first, last } = fixture();
		const range = document.createRange();
		range.setStart(first, 3);
		range.setEnd(last, 2);
		const fragment = range.extractContents();
		expect(fragment.textContent).toBe('Bmiddlela');
		expect(fragment.childNodes[1]).toBe(middle);
		expect(fragment.firstChild).not.toBe(left);
		expect(root.textContent).toBe('A😀st');
		expect(endpoints(range)).toEqual([root, 1, root, 1]);
	});

	it('deletes partial text and contained nodes, retaining boundary ancestors', () => {
		const { document, root, left, right, first, last } = fixture();
		const range = document.createRange();
		range.setStart(first, 3);
		range.setEnd(last, 2);
		range.deleteContents();
		expect(root.childNodes).toEqual([left, right]);
		expect(root.textContent).toBe('A😀st');
		expect(range.collapsed).toBe(true);
	});

	it('clones/extracts comments as character data without stringifying them', () => {
		const document = new Document();
		const comment = document.createComment('abcdef');
		const range = document.createRange();
		range.setStart(comment, 2);
		range.setEnd(comment, 4);
		expect(range.toString()).toBe('');
		expect(range.extractContents().firstChild?.nodeValue).toBe('cd');
		expect(comment.data).toBe('abef');
		expect(endpoints(range)).toEqual([comment, 2, comment, 2]);
	});

	it('keeps cloned and detached ranges live', () => {
		const { document, first } = fixture();
		const range = document.createRange();
		range.selectNodeContents(first);
		const clone = range.cloneRange();
		range.detach();
		first.deleteData(1, 2);
		expect(range.endOffset).toBe(2);
		expect(clone.endOffset).toBe(2);
	});
});

describe('document Selection', () => {
	it('notifies hosts after live boundary edits commit and observer records are queued', () => {
		const seen: string[] = [];
		let armed = false;
		const document = new Document({
			onInvalidate(change) {
				if (change.kind !== 'selection' || !armed) return;
				seen.push(document.documentElement?.textContent ?? '');
				document.documentElement?.setAttribute('selection', 'changed');
			},
		});
		const root = document.createElement('box');
		const text = document.createTextNode('abc');
		root.append(text);
		document.append(root);
		document.getSelection().collapse(text, 2);
		const observer = new MutationObserver(() => {});
		observer.observe(root, { subtree: true, characterData: true, attributes: true });
		armed = true;
		text.deleteData(0, 1);
		expect(seen).toEqual(['bc']);
		expect(observer.takeRecords().map((record) => record.type)).toEqual([
			'characterData',
			'attributes',
		]);
		observer.disconnect();
	});

	it('hides a selected range moved by script to a detached root', () => {
		const { document, first } = fixture();
		const range = document.createRange();
		range.selectNodeContents(first);
		const selection = document.getSelection();
		selection.addRange(range);
		range.selectNodeContents(document.createTextNode('detached'));
		expect(selection.anchorNode).toBeNull();
		expect(selection.focusNode).toBeNull();
		expect(selection.rangeCount).toBe(0);
		expect(selection.isCollapsed).toBe(true);
	});

	it('owns one document-local selection with range identity', () => {
		const { document, first, last } = fixture();
		const selection = document.getSelection();
		expect(document.getSelection()).toBe(selection);
		expect(selection.type).toBe('None');
		expect(selection.rangeCount).toBe(0);
		const range = document.createRange();
		range.selectNodeContents(first);
		selection.addRange(range);
		expect(selection.getRangeAt(0)).toBe(range);
		expect(selection.toString()).toBe('A😀B');
		range.selectNodeContents(last);
		expect(selection.toString()).toBe('last');
		selection.addRange(document.createRange());
		expect(selection.getRangeAt(0)).toBe(range);
		expect(new Document().getSelection().rangeCount).toBe(0);
	});

	it('preserves backward anchor/focus through live range mutation', () => {
		const { document, first, last } = fixture();
		const selection = document.getSelection();
		selection.setBaseAndExtent(last, 3, first, 1);
		expect(selection.direction).toBe('backward');
		expect(selection.anchorNode).toBe(last);
		expect(selection.focusNode).toBe(first);
		first.insertData(0, '_');
		expect(selection.focusOffset).toBe(2);
		expect(selection.anchorOffset).toBe(3);
		selection.extend(last, 4);
		expect(selection.direction).toBe('forward');
		expect(selection.toString()).toBe('t');
	});

	it('collapse replaces the range while deletion mutates the selected range', () => {
		const { document, first } = fixture();
		const selection = document.getSelection();
		selection.setBaseAndExtent(first, 1, first, 3);
		const selected = selection.getRangeAt(0);
		selection.deleteFromDocument();
		expect(selection.getRangeAt(0)).toBe(selected);
		expect(first.data).toBe('AB');
		expect(selection.type).toBe('Caret');
		selection.collapseToEnd();
		expect(selection.getRangeAt(0)).not.toBe(selected);
		selection.removeAllRanges();
		expect(() => selection.collapseToStart()).toThrow(
			expect.objectContaining({ name: 'InvalidStateError' }),
		);
		expect(() => selection.getRangeAt(0)).toThrow(
			expect.objectContaining({ name: 'IndexSizeError' }),
		);
	});

	it('ignores detached and foreign-document ranges', () => {
		const { document } = fixture();
		const detached = document.createTextNode('detached');
		const range = document.createRange();
		range.selectNodeContents(detached);
		const selection = document.getSelection();
		selection.addRange(range);
		expect(selection.rangeCount).toBe(0);
		selection.addRange(new Document().createRange());
		expect(selection.rangeCount).toBe(0);
	});

	it('invalidates selection changes and selected live-range adjustments', () => {
		const invalidate = vi.fn();
		const document = new Document({ onInvalidate: invalidate });
		const root = document.createElement('box');
		const text = document.createTextNode('text');
		root.append(text);
		document.append(root);
		invalidate.mockClear();
		const selection = document.getSelection();
		selection.collapse(text, 2);
		expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'selection' }));
		invalidate.mockClear();
		text.deleteData(0, 1);
		expect(selection.anchorOffset).toBe(1);
		expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'selection' }));
		invalidate.mockClear();
		selection.removeAllRanges();
		expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'selection' }));
	});
});

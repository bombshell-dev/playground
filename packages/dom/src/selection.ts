import { CharacterData, Document, type DocumentFragment, type Node } from './dom.ts';
import { subscribeAfterMutation, subscribeBoundaries, type BoundaryMutation } from './hooks.ts';

type Boundary = readonly [node: Node, offset: number];
const liveRanges = new Set<WeakRef<Range>>();
const changedRanges = new Set<Range>();

function nodeLength(node: Node): number {
	return node instanceof CharacterData ? node.length : node.childNodes.length;
}

function boundary(node: Node, offset: number): Boundary {
	if (node.nodeType === 10)
		throw new DOMException('A doctype cannot be a boundary container', 'InvalidNodeTypeError');
	const converted = Number(offset) >>> 0;
	if (converted > nodeLength(node))
		throw new DOMException('Offset exceeds the node length', 'IndexSizeError');
	return [node, converted];
}

function parentBoundary(node: Node, after: boolean): Boundary {
	const parent = node.parentNode;
	if (!parent) throw new DOMException('Node has no parent', 'InvalidNodeTypeError');
	return [parent, parent.childNodes.indexOf(node) + Number(after)];
}

function sameBoundary(left: Boundary, right: Boundary): boolean {
	return left[0] === right[0] && left[1] === right[1];
}

/** The DOM boundary-point order, including ancestor/descendant boundaries. */
function compare(left: Boundary, right: Boundary): -1 | 0 | 1 {
	const [leftNode, leftOffset] = left;
	const [rightNode, rightOffset] = right;
	if (leftNode.getRootNode() !== rightNode.getRootNode())
		throw new DOMException('Boundary points have different roots', 'WrongDocumentError');
	if (leftNode === rightNode)
		return leftOffset === rightOffset ? 0 : leftOffset < rightOffset ? -1 : 1;
	if (leftNode.contains(rightNode)) {
		let child = rightNode;
		while (child.parentNode && child.parentNode !== leftNode) child = child.parentNode;
		return leftNode.childNodes.indexOf(child) < leftOffset ? 1 : -1;
	}
	if (rightNode.contains(leftNode)) return compare(right, left) === -1 ? 1 : -1;
	const ancestors = new Set<Node>();
	for (let ancestor: Node | null = leftNode; ancestor; ancestor = ancestor.parentNode)
		ancestors.add(ancestor);
	let rightChild = rightNode;
	while (rightChild.parentNode && !ancestors.has(rightChild.parentNode))
		rightChild = rightChild.parentNode;
	const common = rightChild.parentNode;
	if (!common) throw new DOMException('Boundary points have different roots', 'WrongDocumentError');
	let leftChild = leftNode;
	while (leftChild.parentNode && leftChild.parentNode !== common) leftChild = leftChild.parentNode;
	return common.childNodes.indexOf(leftChild) < common.childNodes.indexOf(rightChild) ? -1 : 1;
}

function adjust(point: Boundary, mutation: BoundaryMutation): Boundary {
	const [node, offset] = point;
	if (mutation.type === 'remove') {
		if (mutation.node.contains(node)) return [mutation.parent, mutation.index];
		if (node === mutation.parent && offset > mutation.index) return [node, offset - 1];
	} else if (mutation.type === 'insert') {
		if (node === mutation.parent && offset > mutation.index) return [node, offset + mutation.count];
	} else if (mutation.type === 'text') {
		if (node === mutation.node && offset > mutation.offset) {
			return [
				node,
				offset <= mutation.offset + mutation.count
					? mutation.offset
					: offset + mutation.insertedLength - mutation.count,
			];
		}
	} else if (mutation.node.parentNode) {
		if (node === mutation.node && offset > mutation.offset)
			return [mutation.newNode, offset - mutation.offset];
		const parent = mutation.node.parentNode;
		if (node === parent && offset === parent.childNodes.indexOf(mutation.node) + 1)
			return [node, offset + 1];
	}
	return point;
}

interface ContentPlan {
	node: Node;
	full: boolean;
	text?: { offset: number; count: number };
	children?: ContentPlan[];
}

/** A live range. Construct via Document.createRange(), or pass an explicit document. */
export class Range {
	static readonly START_TO_START = 0;
	static readonly START_TO_END = 1;
	static readonly END_TO_END = 2;
	static readonly END_TO_START = 3;
	readonly START_TO_START = 0;
	readonly START_TO_END = 1;
	readonly END_TO_END = 2;
	readonly END_TO_START = 3;
	#start: Boundary;
	#end: Boundary;
	#document: Document;
	#subscribers = new Set<() => void>();

	constructor(document: Document) {
		this.#document = document;
		this.#start = this.#end = [document, 0];
		liveRanges.add(new WeakRef(this));
	}

	get startContainer(): Node {
		return this.#start[0];
	}
	get startOffset(): number {
		return this.#start[1];
	}
	get endContainer(): Node {
		return this.#end[0];
	}
	get endOffset(): number {
		return this.#end[1];
	}
	get collapsed(): boolean {
		return sameBoundary(this.#start, this.#end);
	}
	get commonAncestorContainer(): Node {
		let node = this.startContainer;
		while (!node.contains(this.endContainer) && node.parentNode) node = node.parentNode;
		return node;
	}

	// oxlint-disable-next-line bombshell-dev/max-params -- Atomically replace both endpoints, optionally deferring host notification until mutation completes.
	#update(start: Boundary, end: Boundary, notify = true): void {
		const changed = !sameBoundary(start, this.#start) || !sameBoundary(end, this.#end);
		this.#start = start;
		this.#end = end;
		if (changed) {
			if (notify) this._notifyChanged();
			else if (this.#subscribers.size) changedRanges.add(this);
		}
	}

	/** @internal */
	_subscribeChanges(callback: () => void): () => void {
		this.#subscribers.add(callback);
		return () => this.#subscribers.delete(callback);
	}

	/** @internal */
	_adjust(mutation: BoundaryMutation): void {
		this.#update(adjust(this.#start, mutation), adjust(this.#end, mutation), false);
	}

	/** @internal */
	_notifyChanged(): void {
		for (const subscriber of this.#subscribers) subscriber();
	}

	setStart(node: Node, offset: number): void {
		const start = boundary(node, offset);
		const end =
			node.getRootNode() !== this.endContainer.getRootNode() || compare(start, this.#end) > 0
				? start
				: this.#end;
		this.#update(start, end);
	}

	setEnd(node: Node, offset: number): void {
		const end = boundary(node, offset);
		const start =
			node.getRootNode() !== this.startContainer.getRootNode() || compare(end, this.#start) < 0
				? end
				: this.#start;
		this.#update(start, end);
	}

	setStartBefore(node: Node): void {
		this.setStart(...parentBoundary(node, false));
	}
	setStartAfter(node: Node): void {
		this.setStart(...parentBoundary(node, true));
	}
	setEndBefore(node: Node): void {
		this.setEnd(...parentBoundary(node, false));
	}
	setEndAfter(node: Node): void {
		this.setEnd(...parentBoundary(node, true));
	}

	collapse(toStart = false): void {
		const point = toStart ? this.#start : this.#end;
		this.#update(point, point);
	}

	selectNode(node: Node): void {
		this.#update(parentBoundary(node, false), parentBoundary(node, true));
	}

	selectNodeContents(node: Node): void {
		this.#update(boundary(node, 0), boundary(node, nodeLength(node)));
	}

	compareBoundaryPoints(how: number, sourceRange: Range): -1 | 0 | 1 {
		switch (how) {
			case 0:
				return compare(this.#start, sourceRange.#start);
			case 1:
				return compare(this.#end, sourceRange.#start);
			case 2:
				return compare(this.#end, sourceRange.#end);
			case 3:
				return compare(this.#start, sourceRange.#end);
			default:
				throw new DOMException('Unknown boundary comparison', 'NotSupportedError');
		}
	}

	comparePoint(node: Node, offset: number): -1 | 0 | 1 {
		if (node.getRootNode() !== this.startContainer.getRootNode())
			throw new DOMException('Node has a different root', 'WrongDocumentError');
		const point = boundary(node, offset);
		return compare(point, this.#start) < 0 ? -1 : compare(point, this.#end) > 0 ? 1 : 0;
	}

	isPointInRange(node: Node, offset: number): boolean {
		if (node.getRootNode() !== this.startContainer.getRootNode()) return false;
		return this.comparePoint(node, offset) === 0;
	}

	intersectsNode(node: Node): boolean {
		if (node.getRootNode() !== this.startContainer.getRootNode()) return false;
		if (!node.parentNode) return true;
		return (
			compare(parentBoundary(node, false), this.#end) < 0 &&
			compare(parentBoundary(node, true), this.#start) > 0
		);
	}

	cloneRange(): Range {
		const clone = new Range(this.#document);
		clone.#start = this.#start;
		clone.#end = this.#end;
		return clone;
	}

	/** The standard legacy method is intentionally a no-op: ranges remain live. */
	detach(): void {}

	toString(): string {
		if (this.collapsed) return '';
		let result = '';
		const visit = (node: Node): void => {
			if (node.nodeType === 3 && node instanceof CharacterData) {
				if (compare([node, 0], this.#end) < 0 && compare([node, node.length], this.#start) > 0) {
					result += node.data.slice(
						node === this.startContainer ? this.startOffset : 0,
						node === this.endContainer ? this.endOffset : node.length,
					);
				}
			} else for (const child of node.childNodes) visit(child);
		};
		visit(this.commonAncestorContainer);
		return result;
	}

	#plans(): ContentPlan[] {
		if (this.collapsed) return [];
		const plan = (node: Node): ContentPlan | undefined => {
			const full =
				compare(this.#start, [node, 0]) < 0 && compare([node, nodeLength(node)], this.#end) < 0;
			if (full) return { node, full };
			if (!node.contains(this.startContainer) && !node.contains(this.endContainer)) return;
			if (node instanceof CharacterData) {
				const offset = node === this.startContainer ? this.startOffset : 0;
				const end = node === this.endContainer ? this.endOffset : node.length;
				return { node, full: false, text: { offset, count: end - offset } };
			}
			const children: ContentPlan[] = [];
			for (const child of node.childNodes) {
				const childPlan = plan(child);
				if (childPlan) children.push(childPlan);
			}
			return { node, full: false, children };
		};
		const common = this.commonAncestorContainer;
		const result: ContentPlan[] = [];
		if (common instanceof CharacterData) {
			const item = plan(common);
			if (item) result.push(item);
		} else
			for (const child of common.childNodes) {
				const item = plan(child);
				if (item) result.push(item);
			}
		return result;
	}

	#collapseForRemoval(): void {
		if (this.startContainer.contains(this.endContainer)) this.#update(this.#start, this.#start);
		else {
			let reference = this.startContainer;
			while (reference.parentNode && !reference.parentNode.contains(this.endContainer))
				reference = reference.parentNode;
			const point = parentBoundary(reference, true);
			this.#update(point, point);
		}
	}

	deleteContents(): void {
		const plans = this.#plans();
		this.#collapseForRemoval();
		const remove = (plan: ContentPlan): void => {
			if (plan.full) plan.node.parentNode?.removeChild(plan.node);
			else if (plan.text && plan.node instanceof CharacterData)
				plan.node.replaceData(plan.text.offset, plan.text.count, '');
			else for (const child of plan.children ?? []) remove(child);
		};
		for (const plan of plans) remove(plan);
	}

	#copyContents(extract: boolean): DocumentFragment {
		const plans = this.#plans();
		const document =
			this.startContainer instanceof Document
				? this.startContainer
				: (this.startContainer.ownerDocument ?? this.#document);
		const fragment = document.createDocumentFragment();
		const check = (plan: ContentPlan): void => {
			if (plan.node.nodeType === 10)
				throw new DOMException('A fragment cannot contain a doctype', 'HierarchyRequestError');
			for (const child of plan.children ?? []) check(child);
		};
		for (const plan of plans) check(plan);
		if (extract) this.#collapseForRemoval();
		const copy = (plan: ContentPlan): Node => {
			if (plan.full) return extract ? plan.node : plan.node.cloneNode(true);
			const clone = plan.node.cloneNode(false);
			if (plan.text && plan.node instanceof CharacterData && clone instanceof CharacterData) {
				clone.data = plan.node.data.slice(plan.text.offset, plan.text.offset + plan.text.count);
				if (extract) plan.node.replaceData(plan.text.offset, plan.text.count, '');
			} else for (const child of plan.children ?? []) clone.appendChild(copy(child));
			return clone;
		};
		for (const plan of plans) fragment.appendChild(copy(plan));
		return fragment;
	}

	cloneContents(): DocumentFragment {
		return this.#copyContents(false);
	}
	extractContents(): DocumentFragment {
		return this.#copyContents(true);
	}
}

subscribeBoundaries((mutation) => {
	for (const reference of liveRanges) {
		const range = reference.deref();
		if (range) range._adjust(mutation);
		else liveRanges.delete(reference);
	}
});

subscribeAfterMutation(() => {
	const changed = [...changedRanges];
	changedRanges.clear();
	for (const range of changed) range._notifyChanged();
});

/** One document's selection, backed by one live Range. */
export class Selection {
	#document: Document;
	#range: Range | null = null;
	#direction: 'forward' | 'backward' | 'none' = 'none';
	#unsubscribe: (() => void) | undefined;

	constructor(document: Document) {
		this.#document = document;
	}

	get rangeCount(): number {
		return this.#visibleRange ? 1 : 0;
	}
	get #visibleRange(): Range | null {
		return this.#range?.startContainer.getRootNode() === this.#document ? this.#range : null;
	}
	get anchorNode(): Node | null {
		return this.#direction === 'backward'
			? (this.#visibleRange?.endContainer ?? null)
			: (this.#visibleRange?.startContainer ?? null);
	}
	get anchorOffset(): number {
		return this.#direction === 'backward'
			? (this.#visibleRange?.endOffset ?? 0)
			: (this.#visibleRange?.startOffset ?? 0);
	}
	get focusNode(): Node | null {
		return this.#direction === 'backward'
			? (this.#visibleRange?.startContainer ?? null)
			: (this.#visibleRange?.endContainer ?? null);
	}
	get focusOffset(): number {
		return this.#direction === 'backward'
			? (this.#visibleRange?.startOffset ?? 0)
			: (this.#visibleRange?.endOffset ?? 0);
	}
	get isCollapsed(): boolean {
		return !this.#visibleRange || this.#visibleRange.collapsed;
	}
	get direction(): 'forward' | 'backward' | 'none' {
		return this.#range ? this.#direction : 'none';
	}
	get type(): 'None' | 'Caret' | 'Range' {
		return !this.#visibleRange ? 'None' : this.isCollapsed ? 'Caret' : 'Range';
	}

	#replace(range: Range | null, direction: 'forward' | 'backward' | 'none'): void {
		if (range === this.#range && direction === this.#direction) return;
		this.#unsubscribe?.();
		this.#range = range;
		this.#direction = direction;
		this.#unsubscribe = range?._subscribeChanges(() => this.#document._selectionChanged());
		this.#document._selectionChanged();
	}

	getRangeAt(index: number): Range {
		if (Number(index) >>> 0 !== 0 || !this.#visibleRange)
			throw new DOMException('Selection has no range at this index', 'IndexSizeError');
		return this.#visibleRange;
	}

	addRange(range: Range): void {
		if (this.rangeCount || range.startContainer.getRootNode() !== this.#document) return;
		this.#replace(range, 'forward');
	}

	removeRange(range: Range): void {
		if (this.#range !== range) throw new DOMException('Range is not selected', 'NotFoundError');
		this.removeAllRanges();
	}

	removeAllRanges(): void {
		this.#replace(null, 'none');
	}
	empty(): void {
		this.removeAllRanges();
	}

	collapse(node: Node | null, offset = 0): void {
		if (node === null) {
			this.removeAllRanges();
			return;
		}
		const point = boundary(node, offset);
		if (node.getRootNode() !== this.#document) return;
		const range = new Range(this.#document);
		range.setStart(...point);
		range.collapse(true);
		this.#replace(range, 'none');
	}

	setPosition(node: Node | null, offset = 0): void {
		this.collapse(node, offset);
	}

	collapseToStart(): void {
		if (!this.#range) throw new DOMException('Selection is empty', 'InvalidStateError');
		this.collapse(this.#range.startContainer, this.#range.startOffset);
	}

	collapseToEnd(): void {
		if (!this.#range) throw new DOMException('Selection is empty', 'InvalidStateError');
		this.collapse(this.#range.endContainer, this.#range.endOffset);
	}

	// oxlint-disable-next-line bombshell-dev/max-params -- This is the standard Selection.setBaseAndExtent signature.
	setBaseAndExtent(
		anchorNode: Node,
		anchorOffset: number,
		focusNode: Node,
		focusOffset: number,
	): void {
		const anchor = boundary(anchorNode, anchorOffset);
		const focus = boundary(focusNode, focusOffset);
		if (anchorNode.getRootNode() !== this.#document || focusNode.getRootNode() !== this.#document)
			return;
		const ordering = compare(anchor, focus);
		const range = new Range(this.#document);
		range.setStart(...(ordering > 0 ? focus : anchor));
		range.setEnd(...(ordering > 0 ? anchor : focus));
		this.#replace(range, ordering > 0 ? 'backward' : 'forward');
	}

	extend(node: Node, offset = 0): void {
		if (node.getRootNode() !== this.#document) return;
		if (!this.#range) throw new DOMException('Selection is empty', 'InvalidStateError');
		const anchor =
			this.#direction === 'backward'
				? ([this.#range.endContainer, this.#range.endOffset] as const)
				: ([this.#range.startContainer, this.#range.startOffset] as const);
		this.setBaseAndExtent(anchor[0], anchor[1], node, offset);
	}

	selectAllChildren(node: Node): void {
		boundary(node, 0);
		if (node.getRootNode() !== this.#document) return;
		const range = new Range(this.#document);
		range.selectNodeContents(node);
		this.#replace(range, 'forward');
	}

	deleteFromDocument(): void {
		this.#range?.deleteContents();
	}
	toString(): string {
		return this.#range?.toString() ?? '';
	}
}

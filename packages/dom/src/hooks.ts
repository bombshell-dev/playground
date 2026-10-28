/* oxlint-disable bombshell-dev/exported-function-async, bombshell-dev/max-params -- Internal synchronous mutation hooks mirror the DOM algorithm arguments. */
import type { Node } from './dom.ts';

export interface MutationRecordData {
	type: 'attributes' | 'characterData' | 'childList';
	target: Node;
	addedNodes?: readonly Node[];
	removedNodes?: readonly Node[];
	previousSibling?: Node | null;
	nextSibling?: Node | null;
	attributeName?: string | null;
	attributeNamespace?: string | null;
	oldValue?: string | null;
}

export type BoundaryMutation =
	| { type: 'remove'; node: Node; parent: Node; index: number }
	| { type: 'insert'; parent: Node; index: number; count: number }
	| { type: 'text'; node: Node; offset: number; count: number; insertedLength: number }
	| { type: 'split'; node: Node; newNode: Node; offset: number };

const mutationSubscribers = new Set<(record: MutationRecordData) => void>();
const boundarySubscribers = new Set<(mutation: BoundaryMutation) => void>();
const afterMutationSubscribers = new Set<() => void>();

/** @internal Subscribe to committed mutations, independently of host invalidation. */
export function subscribeMutations(callback: (record: MutationRecordData) => void): () => void {
	mutationSubscribers.add(callback);
	return () => mutationSubscribers.delete(callback);
}

/** @internal Subscribe to mutation details needed for live boundary updates. */
export function subscribeBoundaries(callback: (mutation: BoundaryMutation) => void): () => void {
	boundarySubscribers.add(callback);
	return () => boundarySubscribers.delete(callback);
}

/** @internal Publish user-observable boundary changes after mutation records are queued. */
export function subscribeAfterMutation(callback: () => void): () => void {
	afterMutationSubscribers.add(callback);
	return () => afterMutationSubscribers.delete(callback);
}

/** @internal Publish a completed node mutation. */
export function notifyMutation(record: MutationRecordData): void {
	for (const subscriber of mutationSubscribers) subscriber(record);
	for (const subscriber of afterMutationSubscribers) subscriber();
}

function notifyBoundary(mutation: BoundaryMutation): void {
	for (const subscriber of boundarySubscribers) subscriber(mutation);
}

/** @internal Capture old ancestry and adjust boundaries before unlinking a child. */
export function notifyBeforeRemove(node: Node, parent: Node, index: number): void {
	notifyBoundary({ type: 'remove', node, parent, index });
}

/** @internal Adjust existing boundaries before linking inserted children. */
export function notifyInsert(parent: Node, index: number, count: number): void {
	notifyBoundary({ type: 'insert', parent, index, count });
}

/** @internal Adjust UTF-16 boundaries before replacing character data. */
export function notifyTextChange(
	node: Node,
	offset: number,
	count: number,
	insertedLength: number,
): void {
	notifyBoundary({ type: 'text', node, offset, count, insertedLength });
}

/** Call after inserting the new text node, before shortening the original. */
export function notifyTextSplit(node: Node, newNode: Node, offset: number): void {
	notifyBoundary({ type: 'split', node, newNode, offset });
}

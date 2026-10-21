/* oxlint-disable bombshell-dev/no-generic-error -- WebIDL and the DOM Standard require TypeError for invalid receivers, callbacks, and observer options. */
import { Document, Node } from './dom.ts';
import { subscribeBoundaries, subscribeMutations, type MutationRecordData } from './hooks.ts';

export interface MutationObserverInit {
	childList?: boolean;
	attributes?: boolean;
	characterData?: boolean;
	subtree?: boolean;
	attributeOldValue?: boolean;
	characterDataOldValue?: boolean;
	attributeFilter?: readonly string[];
}

export interface MutationRecord {
	readonly type: 'attributes' | 'characterData' | 'childList';
	readonly target: Node;
	readonly addedNodes: readonly Node[];
	readonly removedNodes: readonly Node[];
	readonly previousSibling: Node | null;
	readonly nextSibling: Node | null;
	readonly attributeName: string | null;
	readonly attributeNamespace: string | null;
	readonly oldValue: string | null;
}

export type MutationCallback = (
	this: MutationObserver,
	records: MutationRecord[],
	observer: MutationObserver,
) => void;

interface Registration {
	observer: MutationObserver;
	options: MutationObserverInit;
	source?: Registration;
}

// A live target retains its observers; an observer only weakly retains its targets.
const registrations = new WeakMap<Node, Set<Registration>>();
const pendingObservers = new Set<MutationObserver>();
const observerState = new WeakMap<MutationObserver, ObserverState>();
let microtaskPending = false;

interface ObserverState {
	callback: MutationCallback;
	nodes: Set<WeakRef<Node>>;
	transientNodes: Set<WeakRef<Node>>;
	records: MutationRecord[];
}

function state(observer: MutationObserver): ObserverState {
	const value = observerState.get(observer);
	if (!value) throw new TypeError('Invalid MutationObserver receiver');
	return value;
}

function schedule(pendingObserver: MutationObserver): void {
	pendingObservers.add(pendingObserver);
	if (microtaskPending) return;
	microtaskPending = true;
	queueMicrotask(() => {
		microtaskPending = false;
		const pending = [...pendingObservers];
		pendingObservers.clear();
		for (const observer of pending) {
			const info = state(observer);
			const records = observer.takeRecords();
			clearTransients(observer);
			if (!records.length) continue;
			try {
				info.callback.call(observer, records, observer);
			} catch (error) {
				// In this explicit-document environment, report through the first record's host.
				const target = records[0]?.target;
				const document = target instanceof Document ? target : target?.ownerDocument;
				try {
					if (document) document.reportError(error);
					else
						queueMicrotask(() => {
							throw error;
						});
				} catch (reportingError) {
					queueMicrotask(() => {
						throw reportingError;
					});
				}
			}
		}
	});
}

function clearTransients(observer: MutationObserver, source?: Registration): void {
	const info = state(observer);
	for (const reference of info.transientNodes) {
		const target = reference.deref();
		if (!target) continue;
		const entries = registrations.get(target);
		if (!entries) continue;
		for (const entry of entries) {
			if (entry.observer === observer && entry.source && (!source || entry.source === source))
				entries.delete(entry);
		}
	}
	if (!source) info.transientNodes.clear();
}

/** Microtask-delivered records for explicitly observed nodes, including detached nodes. */
export class MutationObserver {
	constructor(callback: MutationCallback) {
		if (typeof callback !== 'function') throw new TypeError('MutationObserver requires a callback');
		observerState.set(this, { callback, nodes: new Set(), transientNodes: new Set(), records: [] });
	}

	observe(target: Node, options: MutationObserverInit = {}): void {
		if (!(target instanceof Node)) throw new TypeError('MutationObserver target must be a Node');
		const normalized = { ...options };
		if (options.attributeFilter)
			normalized.attributeFilter = [...options.attributeFilter].map(String);
		if (
			options.attributes === undefined &&
			(options.attributeOldValue !== undefined || options.attributeFilter !== undefined)
		)
			normalized.attributes = true;
		if (options.characterData === undefined && options.characterDataOldValue !== undefined)
			normalized.characterData = true;
		if (!normalized.childList && !normalized.attributes && !normalized.characterData)
			throw new TypeError('At least one mutation type must be observed');
		if (
			!normalized.attributes &&
			(normalized.attributeOldValue || normalized.attributeFilter !== undefined)
		)
			throw new TypeError('Attribute options require attributes');
		if (!normalized.characterData && normalized.characterDataOldValue)
			throw new TypeError('characterDataOldValue requires characterData');
		let entries = registrations.get(target);
		if (!entries) registrations.set(target, (entries = new Set()));
		const existing = [...entries].find((entry) => entry.observer === this && !entry.source);
		if (existing) {
			clearTransients(this, existing);
			existing.options = normalized;
		} else {
			entries.add({ observer: this, options: normalized });
			state(this).nodes.add(new WeakRef(target));
		}
	}

	disconnect(): void {
		const info = state(this);
		for (const reference of info.nodes) {
			const target = reference.deref();
			if (!target) continue;
			const entries = registrations.get(target);
			if (!entries) continue;
			for (const entry of entries) if (entry.observer === this) entries.delete(entry);
		}
		clearTransients(this);
		info.nodes.clear();
		info.records = [];
	}

	takeRecords(): MutationRecord[] {
		const info = state(this);
		const records = info.records;
		info.records = [];
		return records;
	}
}

subscribeBoundaries((mutation) => {
	if (mutation.type !== 'remove') return;
	for (let ancestor: Node | null = mutation.parent; ancestor; ancestor = ancestor.parentNode) {
		for (const entry of registrations.get(ancestor) ?? []) {
			if (!entry.options.subtree) continue;
			const source = entry.source ?? entry;
			let entries = registrations.get(mutation.node);
			if (!entries) registrations.set(mutation.node, (entries = new Set()));
			if ([...entries].some((candidate) => candidate.source === source)) continue;
			entries.add({ observer: entry.observer, options: source.options, source });
			state(entry.observer).transientNodes.add(new WeakRef(mutation.node));
			schedule(entry.observer);
		}
	}
});

function matches(record: MutationRecordData, options: MutationObserverInit): boolean {
	if (record.type === 'childList') return Boolean(options.childList);
	if (record.type === 'characterData') return Boolean(options.characterData);
	if (!options.attributes) return false;
	return (
		options.attributeFilter === undefined ||
		(!record.attributeNamespace && options.attributeFilter.includes(record.attributeName ?? ''))
	);
}

subscribeMutations((record) => {
	const interested = new Map<MutationObserver, boolean>();
	for (let ancestor: Node | null = record.target; ancestor; ancestor = ancestor.parentNode) {
		for (const { observer, options } of registrations.get(ancestor) ?? []) {
			if (ancestor !== record.target && !options.subtree) continue;
			if (!matches(record, options)) continue;
			const oldValue =
				record.type === 'attributes'
					? options.attributeOldValue
					: record.type === 'characterData' && options.characterDataOldValue;
			interested.set(observer, Boolean(interested.get(observer) || oldValue));
		}
	}
	for (const [observer, includeOldValue] of interested) {
		state(observer).records.push(
			Object.freeze({
				type: record.type,
				target: record.target,
				addedNodes: Object.freeze([...(record.addedNodes ?? [])]),
				removedNodes: Object.freeze([...(record.removedNodes ?? [])]),
				previousSibling: record.previousSibling ?? null,
				nextSibling: record.nextSibling ?? null,
				attributeName: record.attributeName ?? null,
				attributeNamespace: record.attributeNamespace ?? null,
				oldValue: includeOldValue ? (record.oldValue ?? null) : null,
			}),
		);
		schedule(observer);
	}
});

import { EventTarget, Event, MouseEvent, type Event as DOMEvent } from './events.ts';
import { defineFormElements } from './form-elements.ts';
import { DOMTokenList } from './tokens.ts';
import { defineValueElements, cloneValueElementState } from './value-elements.ts';
import { defineInteractiveElements, activateInteractive } from './interactive-elements.ts';
import {
	notifyBeforeRemove,
	notifyInsert,
	notifyMutation,
	notifyTextChange,
	notifyTextSplit,
} from './hooks.ts';

import {
	CustomElementRegistry,
	customConnection,
	customAttribute,
	customAdopted,
	flushReactions,
	enqueueUpgrade,
	withReactions,
	type CustomElementConstructor,
} from './custom-elements.ts';
import { TreeWalker, type NodeFilterCallback } from './traversal.ts';
import { Range, Selection } from './selection.ts';
import { FocusManager, Dispatch, defaultTabIndex } from './focus.ts';
import {
	cloneTextControlState,
	syncTextControlDefault,
	TextControlState,
	InputControlState,
	sanitizeInputValue,
	inputValidity,
	inputValueMode,
	inputValueAsNumber,
	inputValueFromNumber,
	inputValueAsDate,
	inputValueFromDate,
	stepInputValue,
	supportsReadOnly,
	textLengthValidity,
	type SelectionDirection,
	type SelectionMode,
} from './controls.ts';
import {
	formOwner,
	formTree,
	labelsFor,
	isDisabled,
	inDatalist,
	registerControl,
	validityFor,
	validationMessageFor,
	setControlValidity,
	validateControl,
	type ValidityState,
} from './forms.ts';

export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';
export const ELEMENT_NODE = 1;
export const ATTRIBUTE_NODE = 2;
export const TEXT_NODE = 3;
export const COMMENT_NODE = 8;
export const DOCUMENT_NODE = 9;
export const DOCUMENT_FRAGMENT_NODE = 11;

interface State {
	parent: Node | null;
	owner: Document | null;
	children: Node[];
	view: readonly Node[];
}
const states = new WeakMap<Node, State>();
function state(node: Node): State {
	const value = states.get(node);
	// oxlint-disable-next-line bombshell-dev/no-generic-error -- WebIDL brand checks use TypeError.
	if (!value) throw new TypeError('Expected a DOM node');
	return value;
}

/** A host-visible change. Hosts choose how to coalesce these into frames. */
export interface Invalidation {
	readonly kind: 'mutation' | 'focus' | 'selection';
	readonly target: Node;
}
/** Options for a document with no implicit root or process globals. */
export interface MarkupParser {
	parse(
		context: Element | ShadowRoot,
		markup: string,
		options?: { declarativeShadowRoots?: boolean },
	): DocumentFragment;
	serialize(node: Node, options?: HTMLSerializationOptions): string;
}
export interface HTMLSerializationOptions {
	serializableShadowRoots?: boolean;
	shadowRoots?: readonly ShadowRoot[];
}
export interface DocumentOptions {
	onInvalidate?: (change: Invalidation) => void;
	reportError?: (error: unknown) => void;
}
/** Extend this interface with application element names and real subclasses. */
export interface Elements {
	input: HTMLInputElement;
	textarea: HTMLTextAreaElement;
	template: HTMLTemplateElement;
	slot: HTMLSlotElement;
	button: HTMLButtonElement;
	form: HTMLFormElement;
	label: HTMLLabelElement;
	fieldset: HTMLFieldSetElement;
	legend: HTMLLegendElement;
	select: HTMLSelectElement;
	option: HTMLOptionElement;
	optgroup: HTMLOptGroupElement;
	datalist: HTMLDataListElement;
	selectedcontent: HTMLSelectedContentElement;
	output: HTMLOutputElement;
	progress: HTMLProgressElement;
	meter: HTMLMeterElement;
	details: HTMLDetailsElement;
	summary: HTMLSummaryElement;
	dialog: HTMLDialogElement;
}

/** Base of the single in-memory node hierarchy. Collections are live read-only array views. */
export abstract class Node extends EventTarget {
	static readonly ELEMENT_NODE = ELEMENT_NODE;
	static readonly ATTRIBUTE_NODE = ATTRIBUTE_NODE;
	static readonly TEXT_NODE = TEXT_NODE;
	static readonly COMMENT_NODE = COMMENT_NODE;
	static readonly DOCUMENT_NODE = DOCUMENT_NODE;
	static readonly DOCUMENT_FRAGMENT_NODE = DOCUMENT_FRAGMENT_NODE;
	abstract readonly nodeType: number;
	abstract readonly nodeName: string;

	constructor(owner: Document | null) {
		super();
		const children: Node[] = [];
		states.set(this, { parent: null, owner, children, view: readonlyCollection(() => children) });
	}
	get ownerDocument(): Document | null {
		return state(this).owner;
	}
	get parentNode(): Node | null {
		return state(this).parent;
	}
	get parentElement(): Element | null {
		return this.parentNode instanceof Element ? this.parentNode : null;
	}
	get childNodes(): readonly Node[] {
		return state(this).view;
	}
	get firstChild(): Node | null {
		return state(this).children[0] ?? null;
	}
	get lastChild(): Node | null {
		return state(this).children.at(-1) ?? null;
	}
	get previousSibling(): Node | null {
		const siblings = this.parentNode ? state(this.parentNode).children : [];
		return siblings[siblings.indexOf(this) - 1] ?? null;
	}
	get nextSibling(): Node | null {
		const siblings = this.parentNode ? state(this.parentNode).children : [];
		return siblings[siblings.indexOf(this) + 1] ?? null;
	}
	get isConnected(): boolean {
		return this.getRootNode({ composed: true }) instanceof Document;
	}
	get nodeValue(): string | null {
		return null;
	}
	set nodeValue(_value: string | null) {}
	get textContent(): string | null {
		if (this instanceof Document) return null;
		return state(this)
			.children.map((child) => (child instanceof Comment ? '' : (child.textContent ?? '')))
			.join('');
	}
	set textContent(value: string | null) {
		if (this instanceof Document) return;
		const text = value == null ? '' : String(value);
		this.replaceChildren(...(text ? [this.document.createTextNode(text)] : []));
	}
	protected get document(): Document {
		if (this instanceof Document) return this;
		const owner = state(this).owner;
		if (!owner) throw new DOMException('Node has no owner document', 'InvalidStateError');
		return owner;
	}
	getRootNode(options: { composed?: boolean } = {}): Node {
		// oxlint-disable-next-line typescript/no-this-alias -- Mutable tree traversal cursor.
		let node: Node = this;
		while (node.parentNode) node = node.parentNode;
		if (options.composed && node instanceof ShadowRoot) return node.host.getRootNode(options);
		return node;
	}
	hasChildNodes(): boolean {
		return state(this).children.length > 0;
	}
	contains(other: Node | null): boolean {
		for (let node = other; node; node = node.parentNode) if (node === this) return true;
		return false;
	}
	isSameNode(other: Node | null): boolean {
		return this === other;
	}
	appendChild<T extends Node>(node: T): T {
		return this.insertBefore(node, null);
	}
	insertBefore<T extends Node>(node: T, anchor: Node | null): T {
		return withReactions(reactionDocuments(this.document, [node]), () =>
			this.#insertBefore(node, anchor),
		);
	}
	#insertBefore<T extends Node>(node: T, anchor: Node | null, suppressObservers = false): T {
		validateInsertion(this, node, anchor);
		if (node === anchor) return node;
		const nodes = node instanceof DocumentFragment ? [...node.childNodes] : [node];
		if (node instanceof DocumentFragment) {
			for (const child of nodes) {
				notifyBeforeRemove(child, node, 0);
				state(node).children.shift();
				state(child).parent = null;
			}
			if (nodes.length)
				notifyMutation({
					type: 'childList',
					target: node,
					removedNodes: nodes,
					previousSibling: null,
					nextSibling: null,
				});
		} else if (node.parentNode) node.parentNode.#removeChild(node);
		const children = state(this).children;
		const index = anchor ? children.indexOf(anchor) : children.length;
		const previousSibling = children[index - 1] ?? null;
		notifyInsert(this, index, nodes.length);
		for (const child of nodes) {
			adopt(child, this.document);
			state(child).parent = this;
		}
		children.splice(index, 0, ...nodes);
		if (nodes.length) {
			if (!suppressObservers)
				notifyMutation({
					type: 'childList',
					target: this,
					addedNodes: nodes,
					previousSibling,
					nextSibling: anchor,
				});
			this.notifyHost();
			updateSlots(this);
			for (const child of nodes) connectionChanged(child, true);
		}
		return node;
	}
	removeChild<T extends Node>(node: T): T {
		return withReactions(this.document, () => this.#removeChild(node));
	}
	#removeChild<T extends Node>(node: T, suppressObservers = false): T {
		const children = state(this).children;
		const index = children.indexOf(node);
		if (index < 0) throw new DOMException('Node is not a child', 'NotFoundError');
		const previousSibling = children[index - 1] ?? null;
		const nextSibling = children[index + 1] ?? null;
		const connected = node.isConnected;
		notifyBeforeRemove(node, this, index);
		this.document.nodeRemoving(node);
		children.splice(index, 1);
		state(node).parent = null;
		if (!suppressObservers)
			notifyMutation({
				type: 'childList',
				target: this,
				removedNodes: [node],
				previousSibling,
				nextSibling,
			});
		this.notifyHost();
		updateSlots(this);
		updateSlots(node);
		if (connected) connectionChanged(node, false);
		return node;
	}
	replaceChild<T extends Node>(node: Node, child: T): T {
		return withReactions(reactionDocuments(this.document, [node]), () =>
			this.#replaceChild(node, child),
		);
	}
	#replaceChild<T extends Node>(node: Node, child: T): T {
		if (child.parentNode !== this) throw new DOMException('Node is not a child', 'NotFoundError');
		if (node === child) return child;
		validateInsertion(this, node, child, child);
		// Removing the old child first also permits replacing a document element.
		let anchor = child.nextSibling;
		if (anchor === node) anchor = node.nextSibling;
		const addedNodes = node instanceof DocumentFragment ? [...node.childNodes] : [node];
		if (node.parentNode) node.parentNode.#removeChild(node);
		const previousSibling = child.previousSibling;
		this.#removeChild(child, true);
		this.#insertBefore(node, anchor, true);
		notifyMutation({
			type: 'childList',
			target: this,
			addedNodes,
			removedNodes: [child],
			previousSibling,
			nextSibling: anchor,
		});
		return child;
	}
	remove(): void {
		this.parentNode?.removeChild(this);
	}
	protected detachNode(node: Node): void {
		if (node.parentNode) node.parentNode.#removeChild(node);
	}
	append(...nodes: (Node | string)[]): void {
		withReactions(reactionDocuments(this.document, nodes), () => this.#append(nodes));
	}
	#append(nodes: readonly (Node | string)[]): void {
		validateSequence(this, nodes);
		const converted = nodes.map((node) =>
			typeof node === 'string' ? this.document.createTextNode(node) : node,
		);
		for (const node of converted) validateInsertion(this, node, null);
		if (converted.length === 1) this.#insertBefore(converted[0]!, null);
		else if (converted.length) {
			const fragment = this.document.createDocumentFragment();
			for (const node of converted) fragment.#insertBefore(node, null);
			this.#insertBefore(fragment, null);
		}
	}
	prepend(...nodes: (Node | string)[]): void {
		withReactions(reactionDocuments(this.document, nodes), () => this.#prepend(nodes));
	}
	#prepend(nodes: readonly (Node | string)[]): void {
		validateSequence(this, nodes);
		for (const node of nodes) if (typeof node !== 'string') validateInsertion(this, node, null);
		const fragment = this.document.createDocumentFragment();
		for (const node of nodes)
			fragment.#insertBefore(
				typeof node === 'string' ? this.document.createTextNode(node) : node,
				null,
			);
		this.#insertBefore(fragment, this.firstChild);
	}
	replaceChildren(...nodes: (Node | string)[]): void {
		withReactions(reactionDocuments(this.document, nodes), () => this.#replaceChildren(nodes));
	}
	#replaceChildren(nodes: readonly (Node | string)[]): void {
		const converted = nodes.map((node) =>
			typeof node === 'string' ? this.document.createTextNode(node) : node,
		);
		for (const node of converted) validateInsertion(this, node, null, undefined, true);
		if (this instanceof Document) {
			const flattened = converted.flatMap((node) =>
				node instanceof DocumentFragment ? [...node.childNodes] : [node],
			);
			if (flattened.filter((node) => node instanceof Element).length > 1)
				throw new DOMException('Multiple document elements', 'HierarchyRequestError');
		}
		const fragment = this.document.createDocumentFragment();
		for (const node of converted) fragment.#insertBefore(node, null);
		const removedNodes = [...this.childNodes];
		const addedNodes = [...fragment.childNodes];
		for (const node of removedNodes) this.#removeChild(node, true);
		this.#insertBefore(fragment, null, true);
		if (removedNodes.length || addedNodes.length)
			notifyMutation({
				type: 'childList',
				target: this,
				addedNodes,
				removedNodes,
				previousSibling: null,
				nextSibling: null,
			});
	}
	before(...nodes: (Node | string)[]): void {
		withReactions(reactionDocuments(this.document, nodes), () => this.#before(nodes));
	}
	#before(nodes: readonly (Node | string)[]): void {
		const parent = this.parentNode;
		if (!parent || !nodes.length) return;
		validateSequence(parent, nodes);
		for (const node of nodes) if (typeof node !== 'string') validateInsertion(parent, node, this);
		let previous = this.previousSibling;
		while (previous && nodes.includes(previous)) previous = previous.previousSibling;
		const fragment = this.document.createDocumentFragment();
		for (const node of nodes)
			fragment.#insertBefore(
				typeof node === 'string' ? this.document.createTextNode(node) : node,
				null,
			);
		parent.#insertBefore(fragment, previous ? previous.nextSibling : parent.firstChild);
	}
	after(...nodes: (Node | string)[]): void {
		withReactions(reactionDocuments(this.document, nodes), () => this.#after(nodes));
	}
	#after(nodes: readonly (Node | string)[]): void {
		const parent = this.parentNode;
		if (!parent || !nodes.length) return;
		validateSequence(parent, nodes);
		for (const node of nodes) if (typeof node !== 'string') validateInsertion(parent, node, this);
		let anchor = this.nextSibling;
		while (anchor && nodes.includes(anchor)) anchor = anchor.nextSibling;
		const fragment = this.document.createDocumentFragment();
		for (const node of nodes)
			fragment.#insertBefore(
				typeof node === 'string' ? this.document.createTextNode(node) : node,
				null,
			);
		parent.#insertBefore(fragment, anchor);
	}
	replaceWith(...nodes: (Node | string)[]): void {
		withReactions(reactionDocuments(this.document, nodes), () => this.#replaceWith(nodes));
	}
	#replaceWith(nodes: readonly (Node | string)[]): void {
		const parent = this.parentNode;
		if (!parent) return;
		if (nodes.length === 1 && nodes[0] === this) return;
		validateSequence(parent, nodes, { replaced: this });
		for (const node of nodes)
			if (typeof node !== 'string') validateInsertion(parent, node, this, this);
		let anchor = this.nextSibling;
		while (anchor && nodes.includes(anchor)) anchor = anchor.nextSibling;
		const fragment = this.document.createDocumentFragment();
		for (const node of nodes)
			fragment.#insertBefore(
				typeof node === 'string' ? this.document.createTextNode(node) : node,
				null,
			);
		if (this.parentNode === parent) parent.#replaceChild(fragment, this);
		else parent.#insertBefore(fragment, anchor);
	}
	cloneNode(deep = false): Node {
		return withReactions(this.document, () => clone(this, this.document, deep));
	}
	protected override getEventParent(_event: DOMEvent): EventTarget | null {
		return getAssignedSlot(this) ?? this.parentNode;
	}
	protected override retargetEventTarget(target: EventTarget | null): EventTarget | null {
		let candidate = target;
		while (candidate instanceof Node) {
			const root = candidate.getRootNode();
			if (!(root instanceof ShadowRoot)) return candidate;
			// Retargeting is based on shadow-including ancestry, not the event path.
			for (
				// oxlint-disable-next-line typescript/no-this-alias -- Mutable ancestor traversal cursor.
				let current: Node | null = this;
				current;
				current = current.parentNode ?? (current instanceof ShadowRoot ? current.host : null)
			) {
				if (current === root) return candidate;
			}
			candidate = root.host;
		}
		return candidate;
	}
	protected override getEventClosedRoots(): readonly EventTarget[] {
		const roots: ShadowRoot[] = [];
		let root = this.getRootNode();
		while (root instanceof ShadowRoot) {
			if (root.mode === 'closed') roots.push(root);
			root = root.host.getRootNode();
		}
		return roots;
	}
	protected override isEventTargetInShadowTree(): boolean {
		return this.getRootNode() instanceof ShadowRoot;
	}
	protected override reportEventError(error: unknown): void {
		this.document.reportError(error);
	}
	protected notifyHost(kind: Invalidation['kind'] = 'mutation'): void {
		if (this.isConnected) this.document.invalidate({ kind, target: this });
	}
}

// oxlint-disable-next-line bombshell-dev/max-params -- Internal DOM pre-insertion algorithm arguments.
function validateInsertion(
	parent: Node,
	node: Node,
	anchor: Node | null,
	replaced?: Node,
	replacingAll = false,
): void {
	if (
		!(parent instanceof Element || parent instanceof Document || parent instanceof DocumentFragment)
	)
		throw new DOMException('Node cannot have children', 'HierarchyRequestError');
	if (anchor !== null && anchor.parentNode !== parent)
		throw new DOMException('Anchor is not a child', 'NotFoundError');
	// Host-including ancestry also prevents a host being inserted into its shadow tree.
	for (
		let ancestor: Node | null = parent;
		ancestor;
		ancestor = ancestor.parentNode ?? (ancestor instanceof ShadowRoot ? ancestor.host : null)
	) {
		if (ancestor === node)
			throw new DOMException('Insertion would create a cycle', 'HierarchyRequestError');
	}
	if (node instanceof Document || node instanceof Attr || node instanceof ShadowRoot)
		throw new DOMException('Invalid child node type', 'HierarchyRequestError');
	const nodes = node instanceof DocumentFragment ? node.childNodes : [node];
	if (parent instanceof Document) {
		if (nodes.some((child) => child instanceof Text))
			throw new DOMException('Document cannot contain text', 'HierarchyRequestError');
		const existing = replacingAll
			? []
			: parent.childNodes.filter((child) => child !== replaced && child !== node);
		if ([...existing, ...nodes].filter((child) => child instanceof Element).length > 1)
			throw new DOMException('Multiple document elements', 'HierarchyRequestError');
	}
}

/** An independent document; construction neither installs globals nor creates a root. */
export class Document extends Node {
	readonly nodeType = DOCUMENT_NODE;
	readonly nodeName = '#document';
	readonly #options: DocumentOptions;
	readonly customElements: CustomElementRegistry;
	readonly HTMLElement: CustomElementConstructor;
	readonly focusManager: FocusManager;
	readonly dispatch: Dispatch;
	readonly #selection: Selection;
	#selectionQueued = false;
	#parser: MarkupParser | null = null;
	#templateOwner: Document | null = null;
	readonly #elementFactories = new Map<string, (document: Document) => Element>();
	constructor(options: DocumentOptions | (() => void) = {}) {
		super(null);
		this.#options = typeof options === 'function' ? { onInvalidate: options } : options;
		this.customElements = new CustomElementRegistry(this);
		this.HTMLElement = this.customElements.HTMLElement;
		this.focusManager = new FocusManager(this);
		this.dispatch = new Dispatch(this);
		this.#selection = new Selection(this);
	}
	override get ownerDocument(): null {
		return null;
	}
	get documentElement(): Element | null {
		return this.children[0] ?? null;
	}
	get children(): readonly Element[] {
		return elementChildren(this);
	}
	get body(): Element | null {
		return this.documentElement?.children.find((node) => node.localName === 'body') ?? null;
	}
	createElement<K extends keyof Elements>(name: K): Elements[K];
	createElement(name: string): Element;
	createElement(name: string): Element {
		const localName = String(name).toLowerCase();
		validateName(localName);
		const custom = this.customElements.create(localName);
		if (custom) return custom;
		const factory = this.#elementFactories.get(localName);
		if (factory) {
			const element = factory(this);
			if (
				!(element instanceof Element) ||
				element.ownerDocument !== this ||
				element.localName !== localName ||
				element.namespaceURI !== HTML_NAMESPACE ||
				element.parentNode
			)
				throw new DOMException(
					'Element factory returned an incompatible node',
					'NotSupportedError',
				);
			return element;
		}
		if (localName === 'template') return new HTMLTemplateElement(this);
		if (localName === 'slot') return new HTMLSlotElement(this);
		if (localName === 'input') return new HTMLInputElement(this);
		if (localName === 'textarea') return new HTMLTextAreaElement(this);
		const Constructor = Object.hasOwn(specializedElements, localName)
			? specializedElements[localName]
			: undefined;
		if (Constructor) return new Constructor(this);
		return new Element(localName, this);
	}
	/** Register an explicit document-local factory for terminal element names. */
	registerElement(name: string, factory: (document: Document) => Element): void {
		const normalized = String(name).toLowerCase();
		validateName(normalized);
		if (
			normalized.includes('-') ||
			['input', 'textarea', 'template', 'slot'].includes(normalized) ||
			Object.hasOwn(specializedElements, normalized) ||
			this.#elementFactories.has(normalized)
		)
			throw new DOMException('Element name is reserved or already registered', 'NotSupportedError');
		this.#elementFactories.set(normalized, factory);
	}
	createElementNS(namespace: string | null, name: string): Element {
		const parts = qualifiedName(namespace, name);
		if (
			parts.namespaceURI === HTML_NAMESPACE &&
			!parts.prefix &&
			parts.localName === parts.localName.toLowerCase()
		)
			return this.createElement(parts.localName);
		return new Element(parts.localName, this, parts);
	}
	createTextNode(data: string): Text {
		return new Text(String(data), this);
	}
	createComment(data: string): Comment {
		return new Comment(String(data), this);
	}
	createDocumentFragment(): DocumentFragment {
		return new DocumentFragment(this);
	}
	createAttribute(name: string): Attr {
		const normalized = String(name).toLowerCase();
		validateName(normalized);
		return new Attr(normalized, this);
	}
	createAttributeNS(namespace: string | null, name: string): Attr {
		const parts = qualifiedName(namespace, name);
		return new Attr(parts.localName, this, parts);
	}
	adoptNode<T extends Node>(node: T): T {
		return withReactions(reactionDocuments(this, [node]), () => this.#adoptNode(node));
	}
	#adoptNode<T extends Node>(node: T): T {
		if (node instanceof Document || node instanceof ShadowRoot)
			throw new DOMException('Cannot adopt this node', 'NotSupportedError');
		if (node instanceof Attr) node.ownerElement?.removeAttributeNode(node);
		this.detachNode(node);
		adopt(node, this);
		flushReactions(this);
		return node;
	}
	importNode<T extends Node>(node: T, deep = false): Node {
		if (node instanceof Document || node instanceof ShadowRoot)
			throw new DOMException('Cannot import this node', 'NotSupportedError');
		return withReactions(this, () => clone(node, this, deep));
	}
	getElementById(id: string): Element | null {
		return descendants(this).find((node) => node.id === id) ?? null;
	}
	/** Notify the host synchronously; coalescing is the host's responsibility. */
	invalidate(change: Invalidation): void {
		this.#options.onInvalidate?.(change);
	}
	/** Report listener and lifecycle exceptions without stopping dispatch. */
	reportError(error: unknown): void {
		if (this.#options.reportError) this.#options.reportError(error);
		else
			queueMicrotask(() => {
				throw error;
			});
	}
	/** Internal focus-removal hook, completed by the focus subsystem. */
	nodeRemoving(node: Node): void {
		this.focusManager.removing(node);
	}
	get activeElement(): Element | null {
		return this.focusManager.activeElementFor(this);
	}
	createTreeWalker(
		root: Node,
		whatToShow?: number,
		filter?: NodeFilterCallback | null,
	): TreeWalker {
		return new TreeWalker(root, { whatToShow, filter });
	}
	/** Parsing is opt-in through @bomb.sh/dom/parsing. */
	setMarkupParser(parser: MarkupParser): void {
		this.#parser = parser;
	}
	get markupParser(): MarkupParser {
		if (!this.#parser)
			throw new DOMException('Install @bomb.sh/dom/parsing for markup APIs', 'NotSupportedError');
		return this.#parser;
	}
	/** @internal Inert owner document for template contents. */
	get templateOwnerDocument(): Document {
		return (this.#templateOwner ??= new Document());
	}
	createRange(): Range {
		return new Range(this);
	}
	getSelection(): Selection {
		return this.#selection;
	}
	_selectionChanged(): void {
		this.invalidate({ kind: 'selection', target: this });
		if (!this.#selectionQueued) {
			this.#selectionQueued = true;
			setTimeout(() => {
				this.#selectionQueued = false;
				this.dispatchEvent(new Event('selectionchange'));
			}, 0);
		}
	}
}

interface NamespaceName {
	namespaceURI: string | null;
	prefix: string | null;
	localName: string;
}
function validateName(name: string): void {
	if (!/^[\p{L}_:][\p{L}\p{N}_.:\-\u00B7]*$/u.test(name))
		throw new DOMException('Invalid name', 'InvalidCharacterError');
}
function qualifiedName(namespace: string | null, name: string): NamespaceName {
	const namespaceURI = namespace === '' ? null : namespace;
	validateName(String(name));
	const parts = String(name).split(':');
	if (parts.length > 2 || parts.some((part) => !part))
		throw new DOMException('Invalid qualified name', 'NamespaceError');
	const prefix = parts.length === 2 ? parts[0]! : null;
	const localName = parts.at(-1)!;
	if (
		(prefix && !namespaceURI) ||
		(prefix === 'xml' && namespaceURI !== 'http://www.w3.org/XML/1998/namespace') ||
		((prefix === 'xmlns' || name === 'xmlns') &&
			namespaceURI !== 'http://www.w3.org/2000/xmlns/') ||
		(namespaceURI === 'http://www.w3.org/2000/xmlns/' && prefix !== 'xmlns' && name !== 'xmlns')
	)
		throw new DOMException('Invalid namespace', 'NamespaceError');
	return { namespaceURI, prefix, localName };
}

/** An element with namespace-aware attributes and protected tree ownership. */
export class Element extends Node {
	readonly nodeType = ELEMENT_NODE;
	readonly localName: string;
	readonly namespaceURI: string | null;
	readonly prefix: string | null;
	readonly #attributes: Attr[] = [];
	readonly #attributeView = readonlyCollection(() => this.#attributes);
	#clickInProgress = false;
	#classList: DOMTokenList | null = null;

	constructor(name: string, document: Document, options: Partial<NamespaceName> = {}) {
		super(document);
		this.localName = name;
		this.namespaceURI = options.namespaceURI === undefined ? HTML_NAMESPACE : options.namespaceURI;
		this.prefix = options.prefix ?? null;
	}
	override get ownerDocument(): Document {
		return this.document;
	}
	get tagName(): string {
		const name = this.prefix ? `${this.prefix}:${this.localName}` : this.localName;
		return this.namespaceURI === HTML_NAMESPACE ? name.toUpperCase() : name;
	}
	get nodeName(): string {
		return this.tagName;
	}
	get children(): readonly Element[] {
		return elementChildren(this);
	}
	get firstElementChild(): Element | null {
		return this.children[0] ?? null;
	}
	get lastElementChild(): Element | null {
		return this.children.at(-1) ?? null;
	}
	get childElementCount(): number {
		return this.children.length;
	}
	get attributes(): readonly Attr[] {
		return this.#attributeView;
	}
	get innerHTML(): string {
		return this.ownerDocument.markupParser.serialize(
			this instanceof HTMLTemplateElement ? this.content : this,
		);
	}
	getHTML(options: HTMLSerializationOptions = {}): string {
		return this.ownerDocument.markupParser.serialize(
			this instanceof HTMLTemplateElement ? this.content : this,
			options,
		);
	}
	set innerHTML(value: string) {
		withReactions(this.ownerDocument, () => {
			const fragment = this.ownerDocument.markupParser.parse(this, String(value));
			(this instanceof HTMLTemplateElement ? this.content : this).replaceChildren(fragment);
		});
	}
	/** Parse HTML including declarative shadow roots; scripts remain inert. */
	setHTMLUnsafe(value: string): void {
		withReactions(this.ownerDocument, () => {
			const fragment = this.ownerDocument.markupParser.parse(this, String(value), {
				declarativeShadowRoots: true,
			});
			(this instanceof HTMLTemplateElement ? this.content : this).replaceChildren(fragment);
		});
	}
	get hidden(): boolean {
		return this.hasAttribute('hidden');
	}
	set hidden(value: boolean) {
		this.toggleAttribute('hidden', Boolean(value));
	}
	get inert(): boolean {
		return this.hasAttribute('inert');
	}
	set inert(value: boolean) {
		this.toggleAttribute('inert', Boolean(value));
	}
	get autofocus(): boolean {
		return this.hasAttribute('autofocus');
	}
	set autofocus(value: boolean) {
		this.toggleAttribute('autofocus', Boolean(value));
	}
	get contentEditable(): string {
		const value = this.getAttribute('contenteditable')?.toLowerCase();
		return value === '' || value === 'true'
			? 'true'
			: value === 'false' || value === 'plaintext-only'
				? value
				: 'inherit';
	}
	set contentEditable(value: string) {
		const normalized = String(value).toLowerCase();
		if (!['true', 'false', 'plaintext-only', 'inherit'].includes(normalized))
			throw new DOMException('Invalid editable state', 'SyntaxError');
		if (normalized === 'inherit') this.removeAttribute('contenteditable');
		else this.setAttribute('contenteditable', normalized);
	}
	get isContentEditable(): boolean {
		return this.contentEditable === 'inherit'
			? (this.parentElement?.isContentEditable ?? false)
			: this.contentEditable !== 'false';
	}
	click(): void {
		if (this.#clickInProgress || this.activationDisabled()) return;
		this.#clickInProgress = true;
		try {
			this.dispatchEvent(
				new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
			);
		} finally {
			this.#clickInProgress = false;
		}
	}
	protected override hasActivationBehavior(): boolean {
		return (
			this.namespaceURI === HTML_NAMESPACE &&
			['input', 'button', 'label', 'summary'].includes(this.localName)
		);
	}
	protected activationDisabled(): boolean {
		return false;
	}
	protected override activationBehavior(_event: Event, target: EventTarget | null): void {
		activateInteractive(this, target);
	}
	get slot(): string {
		return this.getAttribute('slot') ?? '';
	}
	set slot(value: string) {
		this.setAttribute('slot', value);
	}
	get assignedSlot(): HTMLSlotElement | null {
		return visibleAssignedSlot(this);
	}
	get tabIndex(): number {
		return defaultTabIndex(this);
	}
	set tabIndex(value: number) {
		this.setAttribute('tabindex', String(Number(value) | 0));
	}
	focus(): void {
		this.ownerDocument.focusManager.focus(this);
	}
	blur(): void {
		this.ownerDocument.focusManager.blur(this);
	}
	get id(): string {
		return this.getAttribute('id') ?? '';
	}
	set id(value: string) {
		this.setAttribute('id', value);
	}
	get className(): string {
		return this.getAttribute('class') ?? '';
	}
	get classList(): DOMTokenList {
		return (this.#classList ??= new DOMTokenList(this, 'class'));
	}
	set className(value: string) {
		this.setAttribute('class', value);
	}
	hasAttributes(): boolean {
		return this.#attributes.length > 0;
	}
	getAttributeNames(): string[] {
		return this.#attributes.map((attr) => attr.name);
	}
	getAttributeNode(name: string): Attr | null {
		const normalized =
			this.namespaceURI === HTML_NAMESPACE ? String(name).toLowerCase() : String(name);
		return this.#attributes.find((attr) => attr.name === normalized) ?? null;
	}
	getAttributeNodeNS(namespace: string | null, localName: string): Attr | null {
		return (
			this.#attributes.find(
				(attr) => attr.namespaceURI === (namespace || null) && attr.localName === localName,
			) ?? null
		);
	}
	getAttribute(name: string): string | null {
		return this.getAttributeNode(name)?.value ?? null;
	}
	getAttributeNS(namespace: string | null, localName: string): string | null {
		return this.getAttributeNodeNS(namespace, localName)?.value ?? null;
	}
	hasAttribute(name: string): boolean {
		return this.getAttributeNode(name) !== null;
	}
	hasAttributeNS(namespace: string | null, localName: string): boolean {
		return this.getAttributeNodeNS(namespace, localName) !== null;
	}
	setAttribute(name: string, value: string): void {
		const normalized =
			this.namespaceURI === HTML_NAMESPACE ? String(name).toLowerCase() : String(name);
		validateName(normalized);
		const current = this.getAttributeNode(normalized);
		if (current) current.value = String(value);
		else {
			const attr = new Attr(normalized, this.ownerDocument);
			attr.value = String(value);
			this.setAttributeNode(attr);
		}
	}
	setAttributeNS(namespace: string | null, name: string, value: string): void {
		const parts = qualifiedName(namespace, name);
		const current = this.getAttributeNodeNS(parts.namespaceURI, parts.localName);
		if (current) current.value = String(value);
		else {
			const attr = new Attr(parts.localName, this.ownerDocument, parts);
			attr.value = String(value);
			this.setAttributeNodeNS(attr);
		}
	}
	setAttributeNode(attr: Attr): Attr | null {
		return this.#setAttributeNode(attr);
	}
	setAttributeNodeNS(attr: Attr): Attr | null {
		return this.#setAttributeNode(attr);
	}
	#setAttributeNode(attr: Attr): Attr | null {
		if (attr.ownerElement && attr.ownerElement !== this)
			throw new DOMException('Attribute is already in use', 'InUseAttributeError');
		const previous = this.getAttributeNodeNS(attr.namespaceURI, attr.localName);
		if (previous === attr) return attr;
		if (previous) {
			this.#attributes.splice(this.#attributes.indexOf(previous), 1, attr);
			attributeOwners.delete(previous);
		} else this.#attributes.push(attr);
		attributeOwners.set(attr, this);
		state(attr).owner = this.ownerDocument;
		this.attributeChanged(attr, previous?.value ?? null);
		return previous;
	}
	removeAttribute(name: string): void {
		const attr = this.getAttributeNode(name);
		if (attr) this.removeAttributeNode(attr);
	}
	removeAttributeNS(namespace: string | null, name: string): void {
		const attr = this.getAttributeNodeNS(namespace, name);
		if (attr) this.removeAttributeNode(attr);
	}
	removeAttributeNode(attr: Attr): Attr {
		const index = this.#attributes.indexOf(attr);
		if (index < 0)
			throw new DOMException('Attribute is not owned by this element', 'NotFoundError');
		this.#attributes.splice(index, 1);
		attributeOwners.delete(attr);
		this.attributeChanged(attr, attr.value);
		return attr;
	}
	toggleAttribute(name: string, force?: boolean): boolean {
		if (this.hasAttribute(name)) {
			if (force !== true) this.removeAttribute(name);
		} else if (force !== false) this.setAttribute(name, '');
		return this.hasAttribute(name);
	}
	/** Internal notification shared by attribute setters. */
	attributeChanged(attr: Attr, oldValue: string | null): void {
		notifyMutation({
			type: 'attributes',
			target: this,
			attributeName: attr.localName,
			attributeNamespace: attr.namespaceURI,
			oldValue,
		});
		this.notifyHost();
		updateSlots(this);
		this.ownerDocument.focusManager.revalidate();
		customAttribute(
			this,
			attr.localName,
			oldValue,
			attr.ownerElement === this ? attr.value : null,
			attr.namespaceURI,
		);
		flushReactions(this.ownerDocument);
	}
	attachShadow(options: ShadowRootInit): ShadowRoot {
		if (
			!['open', 'closed'].includes(options.mode) ||
			(options.slotAssignment !== undefined &&
				!['named', 'manual'].includes(options.slotAssignment))
		)
			// oxlint-disable-next-line bombshell-dev/no-generic-error -- Web IDL enum conversion throws TypeError.
			throw new TypeError('Invalid shadow root options');
		if (this.namespaceURI !== HTML_NAMESPACE)
			throw new DOMException('Shadow hosts must be HTML elements', 'NotSupportedError');
		const existing = shadowRoots.get(this);
		if (existing) {
			if (!declarativeRoots.has(existing) || existing.mode !== options.mode)
				throw new DOMException('Shadow root already attached', 'NotSupportedError');
			declarativeRoots.delete(existing);
			existing.replaceChildren();
			return existing;
		}
		const root = new ShadowRoot(this, options);
		shadowRoots.set(this, root);
		this.notifyHost();
		this.ownerDocument.focusManager.revalidate();
		return root;
	}
	get shadowRoot(): ShadowRoot | null {
		const root = shadowRoots.get(this);
		return root?.mode === 'open' ? root : null;
	}
	/** Internal access includes closed roots without exposing them on shadowRoot. */
	protected get internalShadowRoot(): ShadowRoot | null {
		return shadowRoots.get(this) ?? null;
	}
}

/** An owned attribute; attributes are never children. */
export class Attr extends Node {
	readonly nodeType = ATTRIBUTE_NODE;
	readonly localName: string;
	readonly namespaceURI: string | null;
	readonly prefix: string | null;
	#value = '';
	constructor(name: string, document: Document, options: Partial<NamespaceName> = {}) {
		super(document);
		this.localName = name;
		this.namespaceURI = options.namespaceURI ?? null;
		this.prefix = options.prefix ?? null;
	}
	get name(): string {
		return this.prefix ? `${this.prefix}:${this.localName}` : this.localName;
	}
	get nodeName(): string {
		return this.name;
	}
	get ownerElement(): Element | null {
		return attributeOwners.get(this) ?? null;
	}
	get value(): string {
		return this.#value;
	}
	set value(value: string) {
		const old = this.#value;
		this.#value = String(value);
		this.ownerElement?.attributeChanged(this, old);
	}
	override get nodeValue(): string {
		return this.value;
	}
	override set nodeValue(value: string | null) {
		this.value = value ?? '';
	}
	override get textContent(): string {
		return this.value;
	}
	override set textContent(value: string | null) {
		this.value = value ?? '';
	}
}
const attributeOwners = new WeakMap<Attr, Element>();

/** UTF-16 character data shared by Text and Comment. */
export abstract class CharacterData extends Node {
	#data: string;
	constructor(data: string, document: Document) {
		super(document);
		this.#data = String(data);
	}
	get data(): string {
		return this.#data;
	}
	set data(value: string) {
		this.replaceData(0, this.length, String(value));
	}
	get length(): number {
		return this.#data.length;
	}
	override get nodeValue(): string {
		return this.data;
	}
	override set nodeValue(value: string | null) {
		this.data = value ?? '';
	}
	override get textContent(): string {
		return this.data;
	}
	override set textContent(value: string | null) {
		this.data = value ?? '';
	}
	substringData(offset: number, count: number): string {
		offset = checkOffset(this, offset);
		return this.data.slice(offset, offset + (Number(count) >>> 0));
	}
	appendData(data: string): void {
		this.replaceData(this.length, 0, data);
	}
	insertData(offset: number, data: string): void {
		this.replaceData(offset, 0, data);
	}
	deleteData(offset: number, count: number): void {
		this.replaceData(offset, count, '');
	}
	replaceData(offset: number, count: number, data: string): void {
		offset = checkOffset(this, offset);
		const removed = Math.min(Number(count) >>> 0, this.length - offset);
		const added = String(data);
		const oldValue = this.#data;
		notifyTextChange(this, offset, removed, added.length);
		this.#data = oldValue.slice(0, offset) + added + oldValue.slice(offset + removed);
		notifyMutation({ type: 'characterData', target: this, oldValue });
		if (oldValue !== this.#data) this.notifyHost();
	}
}
function checkOffset(node: CharacterData, offset: number): number {
	const converted = Number(offset) >>> 0;
	if (converted > node.length)
		throw new DOMException('Offset is outside character data', 'IndexSizeError');
	return converted;
}
/** A mutable text node. */
export class Text extends CharacterData {
	readonly nodeType = TEXT_NODE;
	readonly nodeName = '#text';
	get assignedSlot(): HTMLSlotElement | null {
		return visibleAssignedSlot(this);
	}
	splitText(offset: number): Text {
		offset = checkOffset(this, offset);
		const result = this.document.createTextNode(this.data.slice(offset));
		this.parentNode?.insertBefore(result, this.nextSibling);
		notifyTextSplit(this, result, offset);
		this.deleteData(offset, this.length - offset);
		return result;
	}
}
/** A comment, excluded from ancestor textContent. */
export class Comment extends CharacterData {
	readonly nodeType = COMMENT_NODE;
	readonly nodeName = '#comment';
}
/** A detached container whose children are moved on insertion. */
export class DocumentFragment extends Node {
	readonly nodeType = DOCUMENT_FRAGMENT_NODE;
	readonly nodeName = '#document-fragment';
	get children(): readonly Element[] {
		return elementChildren(this);
	}
	get firstElementChild(): Element | null {
		return this.children[0] ?? null;
	}
	getElementById(id: string): Element | null {
		return descendants(this).find((node) => node.id === id) ?? null;
	}
}

/** A shadow tree owned by its host document. */
export interface ShadowRootInit {
	mode: 'open' | 'closed';
	delegatesFocus?: boolean;
	slotAssignment?: 'named' | 'manual';
	clonable?: boolean;
	serializable?: boolean;
}
const declarativeRoots = new WeakSet<ShadowRoot>();
/** @internal Preserve declarative-root hydration semantics without exposing mutable state. */
export function markDeclarativeShadowRoot(root: ShadowRoot): void {
	declarativeRoots.add(root);
}
export class ShadowRoot extends DocumentFragment {
	readonly host: Element;
	readonly mode: 'open' | 'closed';
	readonly delegatesFocus: boolean;
	readonly slotAssignment: 'named' | 'manual';
	readonly clonable: boolean;
	readonly serializable: boolean;
	constructor(host: Element, options: ShadowRootInit) {
		super(host.ownerDocument);
		this.host = host;
		this.mode = options.mode;
		this.delegatesFocus = options.delegatesFocus ?? false;
		this.slotAssignment = options.slotAssignment ?? 'named';
		this.clonable = Boolean(options.clonable);
		this.serializable = Boolean(options.serializable);
	}
	get innerHTML(): string {
		return this.host.ownerDocument.markupParser.serialize(this);
	}
	getHTML(options: HTMLSerializationOptions = {}): string {
		return this.host.ownerDocument.markupParser.serialize(this, options);
	}
	set innerHTML(value: string) {
		withReactions(this.host.ownerDocument, () =>
			this.replaceChildren(this.host.ownerDocument.markupParser.parse(this, String(value))),
		);
	}
	setHTMLUnsafe(value: string): void {
		withReactions(this.host.ownerDocument, () =>
			this.replaceChildren(
				this.host.ownerDocument.markupParser.parse(this, String(value), {
					declarativeShadowRoots: true,
				}),
			),
		);
	}
	get activeElement(): Element | null {
		return this.host.ownerDocument.focusManager.activeElementFor(this);
	}
	protected override getEventParent(event: DOMEvent): EventTarget | null {
		return !event.composed && event.target instanceof Node && event.target.getRootNode() === this
			? null
			: this.host;
	}
	override cloneNode(): never {
		throw new DOMException('Cannot clone a shadow root', 'NotSupportedError');
	}
}

function adopt(node: Node, owner: Document): void {
	const oldOwner = state(node).owner;
	state(node).owner = owner;
	if (node instanceof Element) {
		for (const attr of node.attributes) state(attr).owner = owner;
		const shadow = getShadowRoot(node);
		if (shadow) adopt(shadow, owner);
		if (node instanceof HTMLTemplateElement) adopt(node.content, owner.templateOwnerDocument);
		if (oldOwner && oldOwner !== owner) customAdopted(node, oldOwner, owner);
	}
	for (const child of node.childNodes) adopt(child, owner);
}
function connectionChanged(node: Node, connected: boolean): void {
	if (!connected || node.isConnected) customConnection(node, connected);
	if (node.ownerDocument) flushReactions(node.ownerDocument);
}
// oxlint-disable-next-line bombshell-dev/max-params -- Internal DOM cloning algorithm arguments.
function clone(node: Node, owner: Document, deep: boolean): Node {
	let copy: Node;
	if (node instanceof Document) copy = new Document();
	else if (node instanceof ShadowRoot)
		throw new DOMException('Cannot clone a shadow root', 'NotSupportedError');
	else if (node instanceof Element) {
		const customCandidate = node.namespaceURI === HTML_NAMESPACE && node.localName.includes('-');
		const element = customCandidate
			? new Element(node.localName, owner, { namespaceURI: node.namespaceURI, prefix: node.prefix })
			: owner.createElementNS(
					node.namespaceURI,
					node.prefix ? `${node.prefix}:${node.localName}` : node.localName,
				);
		if (customCandidate && owner.customElements.get(node.localName)) enqueueUpgrade(element);
		for (const attr of node.attributes) element.setAttributeNodeNS(cloneAttribute(attr, owner));
		if (deep && node instanceof HTMLTemplateElement && element instanceof HTMLTemplateElement)
			for (const child of node.content.childNodes)
				element.content.appendChild(clone(child, element.content.ownerDocument ?? owner, true));
		const shadow = getShadowRoot(node);
		if (shadow?.clonable) {
			const copiedShadow = element.attachShadow({
				mode: shadow.mode,
				delegatesFocus: shadow.delegatesFocus,
				slotAssignment: shadow.slotAssignment,
				clonable: true,
				serializable: shadow.serializable,
			});
			if (declarativeRoots.has(shadow)) declarativeRoots.add(copiedShadow);
			for (const child of shadow.childNodes) copiedShadow.appendChild(clone(child, owner, true));
		}
		copy = element;
	} else if (node instanceof Text) copy = owner.createTextNode(node.data);
	else if (node instanceof Comment) copy = owner.createComment(node.data);
	else if (node instanceof Attr) copy = cloneAttribute(node, owner);
	else copy = owner.createDocumentFragment();
	if (deep)
		for (const child of node.childNodes)
			copy.appendChild(clone(child, copy instanceof Document ? copy : owner, true));
	if (node instanceof Element && copy instanceof Element) {
		cloneTextControlState(node, copy);
		cloneValueElementState(node, copy);
	}
	return copy;
}
function cloneAttribute(attr: Attr, owner: Document): Attr {
	const result = new Attr(attr.localName, owner, {
		namespaceURI: attr.namespaceURI,
		prefix: attr.prefix,
	});
	result.value = attr.value;
	return result;
}
/** Elements in light-tree order, excluding the root. */
export function descendants(root: Node): Element[] {
	const result: Element[] = [];
	for (const child of root.childNodes) {
		if (child instanceof Element) result.push(child);
		result.push(...descendants(child));
	}
	return result;
}

const shadowRoots = new WeakMap<Element, ShadowRoot>();
/** @internal Shared shadow access for DOM subsystems, including closed roots. */
export function getShadowRoot(element: Element): ShadowRoot | null {
	return shadowRoots.get(element) ?? null;
}

/** Shared text editing, form association, and constraint APIs. */
export abstract class TextControlElement extends Element {
	protected abstract readonly control: TextControlState;
	get value(): string {
		return this.control.value;
	}
	set value(value: string) {
		this.control.value = value;
	}
	get name(): string {
		return this.getAttribute('name') ?? '';
	}
	set name(value: string) {
		this.setAttribute('name', value);
	}
	get disabled(): boolean {
		return this.hasAttribute('disabled');
	}
	set disabled(value: boolean) {
		this.toggleAttribute('disabled', Boolean(value));
	}
	get readOnly(): boolean {
		return this.hasAttribute('readonly');
	}
	set readOnly(value: boolean) {
		this.toggleAttribute('readonly', Boolean(value));
	}
	get required(): boolean {
		return this.hasAttribute('required');
	}
	set required(value: boolean) {
		this.toggleAttribute('required', Boolean(value));
	}
	get placeholder(): string {
		return this.getAttribute('placeholder') ?? '';
	}
	set placeholder(value: string) {
		this.setAttribute('placeholder', value);
	}
	get minLength(): number {
		return this.#lengthAttribute('minlength');
	}
	set minLength(value: number) {
		this.#setLengthAttribute('minlength', value);
	}
	get maxLength(): number {
		return this.#lengthAttribute('maxlength');
	}
	set maxLength(value: number) {
		this.#setLengthAttribute('maxlength', value);
	}
	get form(): HTMLFormElement | null {
		return formOwner(this);
	}
	get labels(): readonly Element[] | null {
		return labelsFor(this);
	}
	get validity(): ValidityState {
		return validityFor(this);
	}
	get validationMessage(): string {
		return validationMessageFor(this);
	}
	get willValidate(): boolean {
		return !isDisabled(this) && !this.readOnly && !inDatalist(this);
	}
	checkValidity(): boolean {
		return validateControl(this);
	}
	reportValidity(): boolean {
		return validateControl(this, true);
	}
	setCustomValidity(message: string): void {
		setControlValidity(this, message);
	}
	get selectionStart(): number | null {
		return this.control.selectionStart;
	}
	set selectionStart(value: number | null) {
		this.control.selectionStart = value;
	}
	get selectionEnd(): number | null {
		return this.control.selectionEnd;
	}
	set selectionEnd(value: number | null) {
		this.control.selectionEnd = value;
	}
	get selectionDirection(): SelectionDirection | null {
		return this.control.selectionDirection;
	}
	set selectionDirection(value: SelectionDirection | null) {
		this.control.selectionDirection = value;
	}
	select(): void {
		this.control.select();
	}
	setSelectionRange(start: number, end: number, direction?: SelectionDirection): void {
		this.control.setSelectionRange(start, end, direction);
	}
	setRangeText(replacement: string): void;
	setRangeText(
		replacement: string,
		start: number,
		end: number,
		selectionMode?: SelectionMode,
	): void;
	setRangeText(
		replacement: string,
		start?: number,
		end?: number,
		selectionMode?: SelectionMode,
	): void {
		this.control.setRangeText(replacement, { start, end, selectionMode });
	}
	#lengthAttribute(name: string): number {
		const raw = this.getAttribute(name);
		if (raw === null || !/^\s*\+?\d+/.test(raw)) return -1;
		const parsed = Number.parseInt(raw, 10);
		return parsed <= 2147483647 ? parsed : -1;
	}
	#setLengthAttribute(name: string, value: number): void {
		const length = Number(value) | 0;
		if (length < 0) throw new DOMException('A length cannot be negative', 'IndexSizeError');
		this.setAttribute(name, String(length));
	}
}
/** Input values, checkedness, constraints, selection, and activation. */
export class HTMLInputElement extends TextControlElement {
	protected readonly control: TextControlState;
	readonly #input: InputControlState;
	constructor(document: Document) {
		super('input', document);
		this.control = new TextControlState({
			element: this,
			multiline: false,
			defaultValue: () => this.defaultValue,
			supportsSelection: () => ['text', 'search', 'url', 'tel', 'password'].includes(this.type),
			sanitize: (value) => sanitizeInputValue(this, value),
		});
		this.#input = new InputControlState(this, this.control);
		registerControl(this, {
			reset: () => this.#input.reset(),
			validity: () => inputValidity(this),
			willValidate: () => this.willValidate,
			value: () => this.value,
			entries: (submitter) => {
				if (!this.name || isDisabled(this) || ['reset', 'button', 'file'].includes(this.type))
					return [];
				if (['checkbox', 'radio'].includes(this.type) && !this.checked) return [];
				if (['submit', 'image'].includes(this.type) && submitter !== this) return [];
				return this.type === 'image'
					? [
							[`${this.name}.x`, '0'],
							[`${this.name}.y`, '0'],
						]
					: [[this.name, this.value]];
			},
		});
	}
	get type(): string {
		const value = this.getAttribute('type')?.toLowerCase() ?? 'text';
		return [
			'hidden',
			'text',
			'search',
			'tel',
			'url',
			'email',
			'password',
			'date',
			'month',
			'week',
			'time',
			'datetime-local',
			'number',
			'range',
			'color',
			'checkbox',
			'radio',
			'file',
			'submit',
			'image',
			'reset',
			'button',
		].includes(value)
			? value
			: 'text';
	}
	set type(value: string) {
		this.setAttribute('type', value);
	}
	override get value(): string {
		const mode = inputValueMode(this.type);
		return mode === 'default/on'
			? (this.getAttribute('value') ?? 'on')
			: mode === 'default'
				? this.defaultValue
				: mode === 'filename'
					? ''
					: this.control.value;
	}
	override set value(value: string) {
		const mode = inputValueMode(this.type);
		const string = value == null ? '' : String(value);
		if (mode === 'filename') {
			if (string)
				throw new DOMException(
					'A file input can only be cleared programmatically',
					'InvalidStateError',
				);
			this.control.value = '';
		} else if (mode === 'default' || mode === 'default/on') this.defaultValue = string;
		else this.control.value = string;
	}
	get defaultValue(): string {
		return this.getAttribute('value') ?? '';
	}
	set defaultValue(value: string) {
		this.setAttribute('value', value);
	}
	get checked(): boolean {
		return this.#input.checked;
	}
	set checked(value: boolean) {
		this.#input.checked = value;
	}
	get defaultChecked(): boolean {
		return this.hasAttribute('checked');
	}
	set defaultChecked(value: boolean) {
		this.toggleAttribute('checked', Boolean(value));
	}
	get indeterminate(): boolean {
		return this.#input.indeterminate;
	}
	set indeterminate(value: boolean) {
		this.#input.indeterminate = value;
	}
	get multiple(): boolean {
		return this.hasAttribute('multiple');
	}
	set multiple(value: boolean) {
		this.toggleAttribute('multiple', Boolean(value));
	}
	get formNoValidate(): boolean {
		return this.hasAttribute('formnovalidate');
	}
	set formNoValidate(value: boolean) {
		this.toggleAttribute('formnovalidate', Boolean(value));
	}
	get formMethod(): string {
		if (!this.hasAttribute('formmethod')) return '';
		const value = this.getAttribute('formmethod')?.toLowerCase();
		return value === 'post' || value === 'dialog' ? value : 'get';
	}
	set formMethod(value: string) {
		this.setAttribute('formmethod', value);
	}
	get min(): string {
		return this.getAttribute('min') ?? '';
	}
	set min(value: string) {
		this.setAttribute('min', value);
	}
	get max(): string {
		return this.getAttribute('max') ?? '';
	}
	set max(value: string) {
		this.setAttribute('max', value);
	}
	get step(): string {
		return this.getAttribute('step') ?? '';
	}
	set step(value: string) {
		this.setAttribute('step', value);
	}
	get pattern(): string {
		return this.getAttribute('pattern') ?? '';
	}
	set pattern(value: string) {
		this.setAttribute('pattern', value);
	}
	get valueAsNumber(): number {
		return inputValueAsNumber(this.type, this.value);
	}
	set valueAsNumber(value: number) {
		this.value = inputValueFromNumber(this.type, Number(value));
	}
	get valueAsDate(): Date | null {
		return inputValueAsDate(this.type, this.value);
	}
	set valueAsDate(value: Date | null) {
		this.value = inputValueFromDate(this.type, value);
	}
	stepUp(amount = 1): void {
		stepInputValue(this, amount);
	}
	stepDown(amount = 1): void {
		stepInputValue(this, -amount);
	}
	get list(): HTMLDataListElement | null {
		const id = this.getAttribute('list');
		if (
			!id ||
			[
				'hidden',
				'password',
				'checkbox',
				'radio',
				'file',
				'submit',
				'image',
				'reset',
				'button',
			].includes(this.type)
		)
			return null;
		const candidate = formTree(this.getRootNode()).find((element) => element.id === id);
		return candidate instanceof HTMLDataListElement ? candidate : null;
	}
	override get labels(): readonly Element[] | null {
		return this.type === 'hidden' ? null : labelsFor(this);
	}
	override get willValidate(): boolean {
		return (
			!isDisabled(this) &&
			!inDatalist(this) &&
			!['hidden', 'reset', 'button'].includes(this.type) &&
			!(this.readOnly && supportsReadOnly(this.type))
		);
	}
	protected override activationDisabled(): boolean {
		return isDisabled(this);
	}
	protected override legacyPreActivationBehavior(): (() => void) | null {
		return this.#input.preActivate();
	}
	protected override activationBehavior(_event: Event): void {
		const changed = this.#input.completeActivation();
		if (['checkbox', 'radio'].includes(this.type) && !this.isConnected) return;
		if (!['checkbox', 'radio'].includes(this.type) && isDisabled(this)) return;
		if (['checkbox', 'radio'].includes(this.type) && changed) {
			this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
			this.dispatchEvent(new Event('change', { bubbles: true }));
		} else if (['submit', 'image'].includes(this.type)) this.form?.requestSubmit(this);
		else if (this.type === 'reset') this.form?.reset();
	}
}
/** Multiline text values, selection, form association, and constraints. */
export class HTMLTextAreaElement extends TextControlElement {
	protected readonly control: TextControlState;
	constructor(document: Document) {
		super('textarea', document);
		this.control = new TextControlState({
			element: this,
			multiline: true,
			defaultValue: () => this.defaultValue,
		});
		registerControl(this, {
			reset: () => this.control.reset(),
			validity: () => ({
				valueMissing: this.required && !this.readOnly && !this.value,
				...textLengthValidity(this, this.value),
			}),
			willValidate: () => this.willValidate,
			value: () => this.value,
			entries: () => (this.name && !isDisabled(this) ? [[this.name, this.value]] : []),
		});
	}
	get type(): 'textarea' {
		return 'textarea';
	}
	get textLength(): number {
		return this.value.length;
	}
	get defaultValue(): string {
		return this.textContent ?? '';
	}
	set defaultValue(value: string) {
		this.textContent = value;
		syncTextControlDefault(this);
	}
	override get labels(): readonly Element[] {
		return labelsFor(this);
	}
}

/** Inert template contents are separate from the template's light-tree children. */
export class HTMLTemplateElement extends Element {
	readonly content: DocumentFragment;
	constructor(document: Document) {
		super('template', document);
		this.content = document.templateOwnerDocument.createDocumentFragment();
	}
	get shadowRootMode(): string {
		const mode = this.getAttribute('shadowrootmode')?.toLowerCase();
		return mode === 'open' || mode === 'closed' ? mode : '';
	}
	set shadowRootMode(value: string) {
		this.setAttribute('shadowrootmode', value);
	}
	get shadowRootSlotAssignment(): string {
		return this.getAttribute('shadowrootslotassignment')?.toLowerCase() === 'manual'
			? 'manual'
			: 'named';
	}
	set shadowRootSlotAssignment(value: string) {
		this.setAttribute('shadowrootslotassignment', value);
	}
	get shadowRootDelegatesFocus(): boolean {
		return this.hasAttribute('shadowrootdelegatesfocus');
	}
	set shadowRootDelegatesFocus(value: boolean) {
		this.toggleAttribute('shadowrootdelegatesfocus', Boolean(value));
	}
	get shadowRootClonable(): boolean {
		return this.hasAttribute('shadowrootclonable');
	}
	set shadowRootClonable(value: boolean) {
		this.toggleAttribute('shadowrootclonable', Boolean(value));
	}
	get shadowRootSerializable(): boolean {
		return this.hasAttribute('shadowrootserializable');
	}
	set shadowRootSerializable(value: boolean) {
		this.toggleAttribute('shadowrootserializable', Boolean(value));
	}
}
const manualSlotNodes = new WeakMap<HTMLSlotElement, readonly WeakRef<Element | Text>[]>();
const manualSlots = new WeakMap<Element | Text, WeakRef<HTMLSlotElement>>();
/** Named slot distribution without rendering or hit testing. */
export class HTMLSlotElement extends Element {
	constructor(document: Document) {
		super('slot', document);
	}
	get name(): string {
		return this.getAttribute('name') ?? '';
	}
	set name(value: string) {
		this.setAttribute('name', value);
	}
	assignedNodes(options: { flatten?: boolean } = {}): readonly Node[] {
		const root = this.getRootNode();
		let nodes: readonly Node[] =
			root instanceof ShadowRoot
				? root.slotAssignment === 'manual'
					? (manualSlotNodes.get(this) ?? []).flatMap((ref) => {
							const node = ref.deref();
							return node && getAssignedSlot(node) === this ? [node] : [];
						})
					: root.host.childNodes.filter((node) => getAssignedSlot(node) === this)
				: [];
		if (options.flatten) {
			if (!nodes.length)
				nodes = this.childNodes.filter((node) => node instanceof Element || node instanceof Text);
			nodes = nodes.flatMap((node) =>
				node instanceof HTMLSlotElement ? [...node.assignedNodes({ flatten: true })] : [node],
			);
		}
		return Object.freeze([...nodes]);
	}
	assignedElements(options: { flatten?: boolean } = {}): readonly Element[] {
		return Object.freeze(
			this.assignedNodes(options).filter((node): node is Element => node instanceof Element),
		);
	}
	assign(...nodes: (Element | Text)[]): void {
		if (nodes.some((node) => !(node instanceof Element || node instanceof Text)))
			// oxlint-disable-next-line bombshell-dev/no-generic-error -- Web IDL rejects nodes outside the slottable union.
			throw new TypeError('Only elements and text nodes are slottable');
		const changed = new Set<HTMLSlotElement>([this]);
		for (const node of nodes) {
			const previous = manualSlots.get(node)?.deref();
			if (previous) changed.add(previous);
		}
		const before = new Map([...changed].map((slot) => [slot, slot.assignedNodes()]));
		for (const ref of manualSlotNodes.get(this) ?? []) {
			const node = ref.deref();
			if (node && manualSlots.get(node)?.deref() === this) manualSlots.delete(node);
		}
		const unique = [...new Set(nodes)];
		for (const node of unique) {
			manualSlots.set(node, new WeakRef(this));
		}
		manualSlotNodes.set(
			this,
			unique.map((node) => new WeakRef(node)),
		);
		for (const slot of changed) {
			updateSlots(slot);
			const previous = before.get(slot) ?? [];
			const next = slot.assignedNodes();
			if (previous.length !== next.length || previous.some((node, index) => node !== next[index])) {
				slot.notifyHost();
				slot.ownerDocument.focusManager.revalidate();
			}
		}
	}
}
/** @internal Resolve slot assignment including closed roots. */
export function getAssignedSlot(node: Node): HTMLSlotElement | null {
	if (!(node instanceof Element || node instanceof Text) || !(node.parentNode instanceof Element))
		return null;
	const root = getShadowRoot(node.parentNode);
	if (!root) return null;
	if (root.slotAssignment === 'manual') {
		const slot = manualSlots.get(node)?.deref();
		return slot?.getRootNode() === root ? slot : null;
	}
	const name = node instanceof Element ? node.slot : '';
	return (
		descendants(root).find(
			(element): element is HTMLSlotElement =>
				element instanceof HTMLSlotElement && element.name === name,
		) ?? null
	);
}
const slotAssignments = new WeakMap<HTMLSlotElement, readonly Node[]>();
const pendingSlots = new Set<HTMLSlotElement>();
function updateSlots(node: Node): void {
	const visit = (root: Node): void => {
		if (root instanceof HTMLSlotElement) {
			const previous = slotAssignments.get(root) ?? [];
			const assigned = root.assignedNodes();
			const next = assigned.length
				? assigned
				: root.childNodes.filter((child) => child instanceof Element || child instanceof Text);
			slotAssignments.set(root, next);
			if (
				previous.length !== next.length ||
				previous.some((value, index) => value !== next[index])
			) {
				if (!pendingSlots.size)
					queueMicrotask(() => {
						const slots = [...pendingSlots];
						pendingSlots.clear();
						for (const slot of slots)
							slot.dispatchEvent(new Event('slotchange', { bubbles: true }));
					});
				pendingSlots.add(root);
			}
		}
		if (root instanceof Element) {
			const shadow = getShadowRoot(root);
			if (shadow) visit(shadow);
		}
		for (const child of root.childNodes) visit(child);
	};
	visit(node.getRootNode({ composed: true }));
}

function visibleAssignedSlot(node: Node): HTMLSlotElement | null {
	const slot = getAssignedSlot(node);
	const root = slot?.getRootNode();
	return root instanceof ShadowRoot && root.mode === 'closed' ? null : slot;
}

export function readonlyCollection<T>(read: () => readonly T[]): readonly T[] {
	const snapshot = (): readonly T[] => Object.freeze([...read()]);
	const reject = (): false => false;
	return new Proxy<T[]>([], {
		get(_target, key) {
			const values = snapshot();
			const value: unknown = Reflect.get(values, key);
			return typeof value === 'function' && key !== 'constructor' ? value.bind(values) : value;
		},
		has(_target, key) {
			return Reflect.has(snapshot(), key);
		},
		ownKeys() {
			return Reflect.ownKeys(snapshot());
		},
		getOwnPropertyDescriptor(_target, key) {
			const descriptor = Reflect.getOwnPropertyDescriptor([...read()], key);
			return descriptor;
		},
		set: reject,
		deleteProperty: reject,
		defineProperty: reject,
		preventExtensions: reject,
		setPrototypeOf: reject,
	});
}

const elementCollections = new WeakMap<Node, readonly Element[]>();
function elementChildren(node: Node): readonly Element[] {
	let collection = elementCollections.get(node);
	if (!collection) {
		collection = readonlyCollection(() =>
			state(node).children.filter((child): child is Element => child instanceof Element),
		);
		elementCollections.set(node, collection);
	}
	return collection;
}

// oxlint-disable-next-line bombshell-dev/max-params -- Validate the complete variadic mutation before transferring any existing node.
function validateSequence(
	parent: Node,
	nodes: readonly (Node | string)[],
	options: { replaced?: Node } = {},
): void {
	for (const node of nodes)
		if (typeof node !== 'string') validateInsertion(parent, node, null, options.replaced);
	if (!(parent instanceof Document)) return;
	if (nodes.some((node) => typeof node === 'string'))
		throw new DOMException('Document cannot contain text', 'HierarchyRequestError');
	const incoming = nodes.flatMap((node) =>
		typeof node === 'string'
			? []
			: node instanceof DocumentFragment
				? [...node.childNodes]
				: [node],
	);
	const final = new Set([
		...parent.childNodes.filter((node) => node !== options.replaced && !incoming.includes(node)),
		...incoming,
	]);
	if ([...final].filter((node) => node instanceof Element).length > 1)
		throw new DOMException('Multiple document elements', 'HierarchyRequestError');
}

export const {
	HTMLFormElement,
	HTMLButtonElement,
	HTMLLabelElement,
	HTMLFieldSetElement,
	HTMLLegendElement,
} = defineFormElements(Element);
export type HTMLFormElement = InstanceType<typeof HTMLFormElement>;
export type HTMLButtonElement = InstanceType<typeof HTMLButtonElement>;
export type HTMLLabelElement = InstanceType<typeof HTMLLabelElement>;
export type HTMLFieldSetElement = InstanceType<typeof HTMLFieldSetElement>;
export type HTMLLegendElement = InstanceType<typeof HTMLLegendElement>;
export const {
	HTMLSelectElement,
	HTMLOptionElement,
	HTMLOptGroupElement,
	HTMLDataListElement,
	HTMLSelectedContentElement,
	HTMLOutputElement,
	HTMLProgressElement,
	HTMLMeterElement,
} = defineValueElements(Element);
export type HTMLSelectElement = InstanceType<typeof HTMLSelectElement>;
export type HTMLOptionElement = InstanceType<typeof HTMLOptionElement>;
export type HTMLOptGroupElement = InstanceType<typeof HTMLOptGroupElement>;
export type HTMLDataListElement = InstanceType<typeof HTMLDataListElement>;
export type HTMLSelectedContentElement = InstanceType<typeof HTMLSelectedContentElement>;
export type HTMLOutputElement = InstanceType<typeof HTMLOutputElement>;
export type HTMLProgressElement = InstanceType<typeof HTMLProgressElement>;
export type HTMLMeterElement = InstanceType<typeof HTMLMeterElement>;
export const { HTMLDetailsElement, HTMLSummaryElement, HTMLDialogElement } =
	defineInteractiveElements(Element);
export type HTMLDetailsElement = InstanceType<typeof HTMLDetailsElement>;
export type HTMLSummaryElement = InstanceType<typeof HTMLSummaryElement>;
export type HTMLDialogElement = InstanceType<typeof HTMLDialogElement>;
const specializedElements: Readonly<
	Record<string, (new (document: Document) => Element) | undefined>
> = {
	button: HTMLButtonElement,
	form: HTMLFormElement,
	label: HTMLLabelElement,
	fieldset: HTMLFieldSetElement,
	legend: HTMLLegendElement,
	select: HTMLSelectElement,
	option: HTMLOptionElement,
	optgroup: HTMLOptGroupElement,
	datalist: HTMLDataListElement,
	selectedcontent: HTMLSelectedContentElement,
	output: HTMLOutputElement,
	progress: HTMLProgressElement,
	meter: HTMLMeterElement,
	details: HTMLDetailsElement,
	summary: HTMLSummaryElement,
	dialog: HTMLDialogElement,
};

function reactionDocuments(document: Document, nodes: readonly (Node | string)[]): Document[] {
	return [
		document,
		...nodes.flatMap((node) =>
			typeof node === 'string' || !node.ownerDocument ? [] : [node.ownerDocument],
		),
	];
}

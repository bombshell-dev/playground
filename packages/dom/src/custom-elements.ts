/* oxlint-disable bombshell-dev/exported-function-async -- DOM custom-element registration and reaction algorithms are synchronous. */
/* oxlint-disable bombshell-dev/no-generic-error -- The HTML construction/definition algorithms require TypeError for invalid constructors and callbacks. */
import { Element, getShadowRoot, type Document, type Node } from './dom.ts';

/** A constructor bound to a document's HTMLElement base. */
export interface CustomElementConstructor {
	new (): Element;
	readonly observedAttributes?: Iterable<string>;
}

type CallbackName =
	| 'connectedCallback'
	| 'disconnectedCallback'
	| 'adoptedCallback'
	| 'attributeChangedCallback';
type LifecycleCallback = (this: Element, ...arguments_: unknown[]) => void;
interface Definition {
	name: string;
	constructor: CustomElementConstructor;
	observed: readonly string[];
	callbacks: Record<CallbackName, LifecycleCallback | null>;
}
interface CustomState {
	definition: Definition;
	status: 'custom' | 'failed' | 'constructing';
}
type Reaction = () => void;
const customStates = new WeakMap<Element, CustomState>();
const reactionQueues = new WeakMap<Element, Reaction[]>();
interface ReactionScope {
	scopes: Element[][];
	pending: Element[];
	scheduled: boolean;
}
const environments = new WeakMap<Document, ReactionScope>();
function environment(document: Document): ReactionScope {
	let state = environments.get(document);
	if (!state) {
		state = { scopes: [], pending: [], scheduled: false };
		environments.set(document, state);
	}
	return state;
}

function enqueue(element: Element, options: { reaction: Reaction; schedule?: boolean }): void {
	let queue = reactionQueues.get(element);
	if (!queue) reactionQueues.set(element, (queue = []));
	queue.push(options.reaction);
	if (options.schedule !== false) {
		const document = element.ownerDocument;
		const state = environment(document);
		const scope = state.scopes.at(-1);
		if (scope) scope.push(element);
		else {
			state.pending.push(element);
			if (!state.scheduled) {
				state.scheduled = true;
				queueMicrotask(() => {
					state.scheduled = false;
					flushReactions(document);
				});
			}
		}
	}
}
function invoke(elements: readonly Element[]): void {
	for (const element of elements) {
		const queue = reactionQueues.get(element);
		// oxlint-disable-next-line no-unmodified-loop-condition -- Each iteration shifts the reaction queue, including reentrant additions.
		while (queue?.length) {
			const reaction = queue.shift();
			try {
				reaction?.();
			} catch (error) {
				try {
					element.ownerDocument.reportError(error);
				} catch (reportingError) {
					queueMicrotask(() => {
						throw reportingError;
					});
				}
			}
		}
	}
}
/** @internal Complete one DOM operation before invoking its custom-element reactions. */
export function withReactions<T>(documents: Document | readonly Document[], operation: () => T): T {
	const queue: Element[] = [];
	const states = [...new Set(Array.isArray(documents) ? documents : [documents])].map(environment);
	for (const state of states) state.scopes.push(queue);
	try {
		return operation();
	} finally {
		for (const state of states) state.scopes.pop();
		invoke(queue);
	}
}
/** @internal Parsing joins its caller's mutation scope, or owns one for direct parser calls. */
export function withParsingReactions<T>(document: Document, operation: () => T): T {
	return environment(document).scopes.length ? operation() : withReactions(document, operation);
}
/** @internal Drain only this document's backup reactions. */
export function flushReactions(document: Document): void {
	const state = environment(document);
	if (state.scopes.length) return;
	const queue = state.pending;
	state.pending = [];
	invoke(queue);
}
/** @internal Defer construction until the enclosing mutation has finished. */
export function enqueueUpgrade(element: Element): void {
	enqueue(element, {
		reaction: () => element.ownerDocument.customElements.upgradeElement(element),
	});
}
function validName(name: string): boolean {
	return (
		/^[a-z][.0-9_a-z-]*-[.0-9_a-z-]*$/.test(name) &&
		![
			'annotation-xml',
			'color-profile',
			'font-face',
			'font-face-src',
			'font-face-uri',
			'font-face-format',
			'font-face-name',
			'missing-glyph',
		].includes(name)
	);
}
function getCallback(prototype: object, name: CallbackName): LifecycleCallback | null {
	const value: unknown = Reflect.get(prototype, name);
	if (value === undefined) return null;
	if (typeof value !== 'function') throw new TypeError(`${name} must be callable`);
	return function (...arguments_: unknown[]): void {
		Reflect.apply(value, this, arguments_);
	};
}
// oxlint-disable-next-line bombshell-dev/max-params -- Internal lifecycle dispatch needs element, captured callback definition, arguments, and scheduling mode.
function enqueueCallback(
	element: Element,
	definition: Definition,
	name: CallbackName,
	arguments_: unknown[],
	schedule = true,
): void {
	const callback = definition.callbacks[name];
	if (callback) enqueue(element, { reaction: () => callback.apply(element, arguments_), schedule });
}
/** @internal Traverse shadow-including descendants for lifecycle delivery. */
export function customConnection(node: Node, connected: boolean): void {
	if (node instanceof Element) {
		const state = customStates.get(node);
		if (connected && !state) enqueueUpgrade(node);
		if (state?.status === 'custom')
			enqueueCallback(
				node,
				state.definition,
				connected ? 'connectedCallback' : 'disconnectedCallback',
				[],
			);
		const shadow = getShadowRoot(node);
		if (shadow) for (const child of shadow.childNodes) customConnection(child, connected);
	}
	for (const child of node.childNodes) customConnection(child, connected);
}
/* oxlint-disable bombshell-dev/max-params -- Preserve the DOM attribute-change and HTML adoption algorithm inputs. */
/** @internal Queue observed-attribute reactions independently of rendering invalidation. */
export function customAttribute(
	element: Element,
	name: string,
	oldValue: string | null,
	value: string | null,
	namespace: string | null,
): void {
	const state = customStates.get(element);
	if (state?.status !== 'custom' || !state.definition.observed.includes(name)) return;
	enqueueCallback(element, state.definition, 'attributeChangedCallback', [
		name,
		oldValue,
		value,
		namespace,
	]);
}
/** @internal Preserve the original definition when adopting across documents. */
export function customAdopted(
	element: Element,
	oldDocument: Document,
	newDocument: Document,
): void {
	const state = customStates.get(element);
	if (state?.status === 'custom')
		enqueueCallback(element, state.definition, 'adoptedCallback', [oldDocument, newDocument]);
}
/* oxlint-enable bombshell-dev/max-params */

/** Autonomous custom elements with identity-preserving, document-local upgrades. */
export class CustomElementRegistry {
	readonly #document: Document;
	readonly #definitions = new Map<string, Definition>();
	readonly #constructors = new Map<CustomElementConstructor, Definition>();
	readonly #waiting = new Map<
		string,
		{
			promise: Promise<CustomElementConstructor>;
			resolve: (constructor: CustomElementConstructor) => void;
		}
	>();
	readonly #stack: { definition: Definition; element: Element; consumed: boolean }[] = [];
	#defining = false;
	readonly HTMLElement: CustomElementConstructor;
	constructor(document: Document) {
		this.#document = document;
		// oxlint-disable-next-line typescript/no-this-alias -- The document-bound constructor closes over its owning registry.
		const registry = this;
		this.HTMLElement = class HTMLElement extends Element {
			constructor() {
				const definition = registry.#constructors.get(new.target);
				if (!definition)
					throw new TypeError('Custom element constructor is not registered in this document');
				super(definition.name, document);
				const entry = registry.#stack.at(-1);
				if (entry?.definition === definition) {
					if (entry.consumed)
						throw new DOMException('Element already constructed', 'InvalidStateError');
					entry.consumed = true;
					return entry.element;
				}
				customStates.set(this, { definition, status: 'custom' });
			}
		};
	}
	define(name: string, constructor: CustomElementConstructor): void {
		withReactions(this.#document, () => {
			if (!validName(name)) throw new DOMException('Invalid custom element name', 'SyntaxError');
			if (this.#definitions.has(name) || this.#constructors.has(constructor) || this.#defining)
				throw new DOMException('Definition already registered or running', 'NotSupportedError');
			if (!(constructor.prototype instanceof this.HTMLElement))
				throw new TypeError('Extend this document’s HTMLElement constructor');
			let definition: Definition;
			this.#defining = true;
			try {
				const callbacks: Definition['callbacks'] = {
					connectedCallback: getCallback(constructor.prototype, 'connectedCallback'),
					disconnectedCallback: getCallback(constructor.prototype, 'disconnectedCallback'),
					adoptedCallback: getCallback(constructor.prototype, 'adoptedCallback'),
					attributeChangedCallback: getCallback(constructor.prototype, 'attributeChangedCallback'),
				};
				const attributes = callbacks.attributeChangedCallback
					? constructor.observedAttributes
					: undefined;
				definition = {
					name,
					constructor,
					callbacks,
					observed: attributes === undefined ? [] : [...attributes].map(String),
				};
			} finally {
				this.#defining = false;
			}
			this.#definitions.set(name, definition);
			this.#constructors.set(constructor, definition);
			this.#enqueueUpgrades(this.#document);
			this.#waiting.get(name)?.resolve(constructor);
			this.#waiting.delete(name);
		});
	}
	get(name: string): CustomElementConstructor | undefined {
		return this.#definitions.get(name)?.constructor;
	}
	getName(constructor: CustomElementConstructor): string | null {
		return this.#constructors.get(constructor)?.name ?? null;
	}
	whenDefined(name: string): Promise<CustomElementConstructor> {
		if (!validName(name))
			return Promise.reject(new DOMException('Invalid custom element name', 'SyntaxError'));
		const constructor = this.get(name);
		if (constructor) return Promise.resolve(constructor);
		let waiting = this.#waiting.get(name);
		if (!waiting) {
			waiting = Promise.withResolvers<CustomElementConstructor>();
			this.#waiting.set(name, waiting);
		}
		return waiting.promise;
	}
	/** @internal Construct an already-registered element. */
	create(name: string): Element | null {
		const definition = this.#definitions.get(name);
		if (!definition) return null;
		try {
			const element = new definition.constructor();
			if (
				!(element instanceof Element) ||
				customStates.get(element)?.definition !== definition ||
				element.ownerDocument !== this.#document ||
				element.localName !== name ||
				element.parentNode ||
				element.childNodes.length ||
				element.attributes.length
			)
				throw new DOMException('Invalid custom element construction result', 'NotSupportedError');
			return element;
		} catch (error) {
			this.#document.reportError(error);
			const failed = new Element(name, this.#document);
			customStates.set(failed, { definition, status: 'failed' });
			return failed;
		}
	}
	upgrade(root: Node): void {
		withReactions(this.#document, () => this.#enqueueUpgrades(root));
	}
	#enqueueUpgrades(root: Node): void {
		const visit = (node: Node): void => {
			if (node instanceof Element) {
				if (node.ownerDocument === this.#document)
					enqueue(node, { reaction: () => this.upgradeElement(node) });
				const shadow = getShadowRoot(node);
				if (shadow) visit(shadow);
			}
			for (const child of node.childNodes) visit(child);
		};
		visit(root);
	}
	/** @internal Upgrade one queued candidate; its existing reactions follow construction. */
	upgradeElement(element: Element): void {
		if (
			customStates.has(element) ||
			element.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
			element.ownerDocument !== this.#document
		)
			return;
		const definition = this.#definitions.get(element.localName);
		if (!definition) return;
		const state: CustomState = { definition, status: 'constructing' };
		customStates.set(element, state);
		for (const attr of element.attributes) {
			if (definition.observed.includes(attr.localName))
				enqueueCallback(
					element,
					definition,
					'attributeChangedCallback',
					[attr.localName, null, attr.value, attr.namespaceURI],
					false,
				);
		}
		if (element.isConnected) enqueueCallback(element, definition, 'connectedCallback', [], false);
		const entry = { definition, element, consumed: false };
		this.#stack.push(entry);
		try {
			Object.setPrototypeOf(element, definition.constructor.prototype);
			const result = new definition.constructor();
			if (result !== element || !entry.consumed)
				throw new TypeError('Upgrade constructor did not return the existing element');
			state.status = 'custom';
		} catch (error) {
			state.status = 'failed';
			const queue = reactionQueues.get(element);
			if (queue) queue.length = 0;
			this.#document.reportError(error);
		} finally {
			this.#stack.pop();
		}
	}
}

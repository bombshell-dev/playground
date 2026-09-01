/**
 * Ghostwright terminal extension for the clack.ui semantic tree protocol, plus
 * the tree-aware CSS locator (REQ-015..REQ-021).
 *
 * Architecture mirrors the retired freedom-tty consumer: strict decode with
 * stable error codes, ordered revisions via the extension session context, a
 * css-select evaluation over the materialized node tree, and the geometry ->
 * screen-region bridge that scopes ghostwright's revision-driven assertions.
 */
import { compile, type Options } from 'css-select';
import { AttributeAction, parse, SelectorType, type Selector } from 'css-what';
import { GhostwrightError } from 'ghostwright';
import type {
	AsyncRegion,
	AsyncTerminal,
	ExtensionRevision,
	ExtensionSessionContext,
	Rect,
	RegisteredOscMessage,
	TerminalExtensionDefinition,
	TextLocatorOptions,
} from 'ghostwright';
import {
	CLACK_TTY_NAMESPACE,
	CLACK_TTY_OSC,
	decodeFrame,
	type ClackFrameV1,
	type ClackNodeV1,
	type Rect as ProtocolRect,
} from './protocol.ts';

export * from './protocol.ts';

const LIMITS = {
	selectorBytes: 4096,
	selectorTokens: 256,
	selectorBranches: 32,
	selectorDepth: 8,
	hasDepth: 2,
} as const;
const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;
const fail = (code: string, message: string): never => {
	throw new GhostwrightError({ code, message: message.slice(0, 1024) });
};

/** A resolved tree match: semantic data plus the bridge rect for screen scoping. */
export interface TreeMatch extends ClackNodeV1 {
	/** Cell rect used to scope screen assertions: `visible` when present, else `term`. */
	readonly range?: Rect;
}

interface Element extends ClackNodeV1 {
	parentNode: Element | null;
	children: Element[];
}

function materialize(frame: ClackFrameV1): Element[] {
	const nodes = frame.nodes.map((node) => ({
		...node,
		parentNode: null as Element | null,
		children: [] as Element[],
	}));
	const byKey = new Map(nodes.map((node) => [node.key, node]));
	for (const node of nodes) {
		const parent = node.parent ? byKey.get(node.parent) : undefined;
		if (parent) {
			node.parentNode = parent;
			parent.children.push(node);
		}
	}
	for (const node of nodes) node.children.sort((a, b) => a.order - b.order);
	return nodes;
}

function attribute(node: Element, name: string): string | undefined {
	if (name === 'id') return node.key;
	// Boolean attributes follow CSS presence semantics: present only when true.
	const boolean =
		name === 'input'
			? node.attrs.input
			: name === 'focusable'
				? node.attrs.focusable
				: name === 'focused'
					? node.states.focused
					: name === 'focus-root'
						? node.states.focusRoot
						: undefined;
	if (boolean !== undefined) return boolean ? 'true' : undefined;
	const value =
		name === 'role'
			? node.attrs.role
			: name === 'label'
				? node.attrs.label
				: name === 'type'
					? node.attrs.custom?.type
					: name.startsWith('data-')
						? node.attrs.custom?.[name.slice(5)]
						: undefined;
	return value === undefined ? undefined : String(value);
}

const adapter: NonNullable<Options<Element, Element>['adapter']> = {
	isTag: (node): node is Element => !!node,
	getName: (node) => node.name,
	getChildren: (node) => node.children,
	getParent: (node) => node.parentNode,
	getSiblings: (node) => node.parentNode?.children ?? [node],
	prevElementSibling: (node) => {
		const siblings = node.parentNode?.children ?? [node],
			index = siblings.indexOf(node);
		return index > 0 ? (siblings[index - 1] ?? null) : null;
	},
	getAttributeValue: attribute,
	hasAttrib: (node, name) => attribute(node, name) !== undefined,
	getText: (node) =>
		[node.attrs.label ?? '', ...node.children.map((child) => adapter.getText(child))]
			.filter(Boolean)
			.join(' '),
	removeSubsets: (nodes) =>
		nodes.filter(
			(node) =>
				!nodes.some((candidate) => {
					for (let parent = node.parentNode; parent; parent = parent.parentNode)
						if (parent === candidate) return true;
					return false;
				}),
		),
	equals: (left, right) => left.key === right.key,
};

const options: Options<Element, Element> = {
	adapter,
	xmlMode: true,
	cacheResults: false,
	pseudos: {
		focus: (node) => node.states.focused,
		'focus-root': (node) => node.states.focusRoot,
		visible: (node) => !!node.geo?.visible,
	},
};

const allowedPseudos = new Set([
	'not',
	'is',
	'where',
	'has',
	'root',
	'empty',
	'first-child',
	'last-child',
	'only-child',
	'first-of-type',
	'last-of-type',
	'nth-child',
	'nth-last-child',
	'nth-of-type',
	'nth-last-of-type',
	'focus',
	'focus-root',
	'visible',
]);

/** Validate and compile a bounded selector (REQ-018). */
function selector(source: string): Selector[][] {
	if (utf8Bytes(source) > LIMITS.selectorBytes)
		fail('GW_CLACK_SELECTOR_LIMIT', `Selector exceeds ${LIMITS.selectorBytes} bytes`);
	let ast: Selector[][] = [];
	try {
		ast = parse(source);
	} catch {
		fail('GW_CLACK_SELECTOR_INVALID', 'Malformed semantic selector');
	}
	let tokens = 0,
		branches = 0;
	const visit = (lists: Selector[][], depth: number, hasDepth: number) => {
		if (depth > LIMITS.selectorDepth)
			fail('GW_CLACK_SELECTOR_LIMIT', 'Selector nesting exceeds limit');
		branches += lists.length;
		if (branches > LIMITS.selectorBranches)
			fail('GW_CLACK_SELECTOR_LIMIT', 'Selector list exceeds limit');
		for (const list of lists)
			for (const token of list) {
				if (++tokens > LIMITS.selectorTokens)
					fail('GW_CLACK_SELECTOR_LIMIT', 'Selector token limit exceeded');
				if (token.type === SelectorType.PseudoElement)
					fail('GW_CLACK_SELECTOR_INVALID', 'Pseudo-elements are not supported');
				if (token.type === SelectorType.Parent || token.type === SelectorType.ColumnCombinator)
					fail(
						'GW_CLACK_SELECTOR_INVALID',
						`Selector traversal ${token.type} is not supported`,
					);
				if (token.type === SelectorType.Attribute && token.action === AttributeAction.Not)
					fail(
						'GW_CLACK_SELECTOR_INVALID',
						'The nonstandard != attribute operator is not supported',
					);
				if (token.type === SelectorType.Pseudo) {
					if (!allowedPseudos.has(token.name))
						fail(
							'GW_CLACK_SELECTOR_INVALID',
							`Pseudo-class :${token.name} is not supported`,
						);
					if (token.name === 'has' && hasDepth >= LIMITS.hasDepth)
						fail('GW_CLACK_SELECTOR_LIMIT', `Nested :has() exceeds depth ${LIMITS.hasDepth}`);
					if (Array.isArray(token.data))
						visit(token.data, depth + 1, token.name === 'has' ? hasDepth + 1 : hasDepth);
				}
			}
	};
	visit(ast, 0, 0);
	return ast;
}

function bridgeRect(node: ClackNodeV1): ProtocolRect | undefined {
	return node.geo?.visible ?? node.geo?.term;
}

export class ClackTtyLocator {
	readonly #predicate: (node: Element) => boolean;
	readonly session: ClackTtySession;
	readonly source: string;
	readonly index: number | undefined;
	constructor(session: ClackTtySession, source: string, index?: number) {
		this.session = session;
		this.source = source;
		this.index = index;
		this.#predicate = compile(selector(source), options);
	}
	/** Resolved tree matches, newest frame, document order (REQ-019). */
	matches(): readonly TreeMatch[] {
		const nodes = this.session.document();
		const values = nodes.filter(this.#predicate);
		const selected =
			this.index === undefined ? values : values[this.index] ? [values[this.index]!] : [];
		return Object.freeze(
			selected.map((node) => {
				const rect = bridgeRect(node);
				return {
					...node,
					...(rect
						? {
								range: {
									column: rect.column,
									row: rect.row,
									width: rect.width,
									height: rect.height,
								} as Rect,
							}
						: {}),
				} as TreeMatch;
			}),
		);
	}
	unique(): TreeMatch {
		const matches = this.matches();
		if (matches.length !== 1)
			fail(
				'GW_CLACK_LOCATOR_STRICT',
				`Selector ${JSON.stringify(this.source)} matched ${matches.length}: ${matches
					.slice(0, 20)
					.map((node) => `${node.key}/${node.name}`)
					.join(', ')}`,
			);
		return matches[0]!;
	}
	nth(index: number): ClackTtyLocator {
		if (!Number.isSafeInteger(index) || index < 0)
			fail('GW_CLACK_LOCATOR_RANGE', 'Locator index must be a nonnegative safe integer');
		return new ClackTtyLocator(this.session, this.source, index);
	}
	#regionBounds(): Rect {
		const node = this.unique();
		const rect = node.range;
		if (!rect)
			fail(
				'GW_CLACK_NO_GEOMETRY',
				`Selector ${JSON.stringify(this.source)} matched ${node.key}/${node.name} without geometry`,
			);
		return rect;
	}
	/** Screen region scoped to the match's geometry (REQ-020). */
	region(): AsyncRegion {
		return this.session.terminal.region(this.#regionBounds());
	}
	/** Text assertion scoped to the match's on-screen rect (REQ-020). */
	getByText(textValue: string, textOptions?: TextLocatorOptions) {
		return this.region().getByText(textValue, textOptions);
	}
}

export class ClackTtySession {
	#current?: ClackFrameV1;
	#revisions: ExtensionRevision<ClackFrameV1>[] = [];
	#documentFrame = -1;
	#document: Element[] = [];
	readonly terminal: AsyncTerminal;
	constructor(terminal: AsyncTerminal) {
		this.terminal = terminal;
	}
	validateNext(frame: ClackFrameV1) {
		if (this.#current && frame.frame !== this.#current.frame + 1)
			fail(
				'GW_CLACK_FRAME',
				`Semantic frame ${frame.frame} does not follow accepted frame ${this.#current.frame}`,
			);
	}
	setCurrent(frame: ClackFrameV1) {
		this.#current = frame;
		this.#documentFrame = -1;
	}
	record(revision: ExtensionRevision<ClackFrameV1>) {
		this.#revisions.push(revision);
	}
	current() {
		return this.#current;
	}
	frames() {
		return Object.freeze(this.#revisions.map((revision) => revision.value));
	}
	revisions() {
		return Object.freeze([...this.#revisions]);
	}
	document(): readonly Element[] {
		if (!this.#current) return [];
		if (this.#documentFrame !== this.#current.frame) {
			this.#document = materialize(this.#current);
			this.#documentFrame = this.#current.frame;
		}
		return this.#document;
	}
	/** Tree-aware CSS locator against the newest accepted frame (REQ-017). */
	locator(source: string) {
		return new ClackTtyLocator(this, source);
	}
}

/** Ghostwright extension definition for the clack.ui semantic tree (REQ-015). */
export function clackTtyExtension(): TerminalExtensionDefinition<
	ClackTtySession,
	ClackFrameV1
> {
	return {
		id: 'ghostwright.clack-tty',
		osc: {
			number: CLACK_TTY_OSC,
			namespace: CLACK_TTY_NAMESPACE,
			maxBufferedBytes: 1024 * 1024,
			decode(message: RegisteredOscMessage) {
				if (message.parameters.length !== 1 || message.parameters[0] !== 'v=1')
					fail('GW_CLACK_VERSION', 'Unsupported semantic envelope version');
				return decodeFrame(message.payload);
			},
		},
		createSession(context: ExtensionSessionContext<ClackFrameV1>) {
			return new ClackTtySession(context.terminal);
		},
		accept(
			session: ClackTtySession,
			frame: ClackFrameV1,
			context: ExtensionSessionContext<ClackFrameV1>,
		) {
			session.validateNext(frame);
			session.setCurrent(frame);
			const revision = context.publish({ protocolFrame: frame.frame, value: frame });
			session.record(revision);
		},
	};
}

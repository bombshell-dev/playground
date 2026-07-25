import { compile, type Options } from 'css-select';
import { AttributeAction, parse, SelectorType, type Selector } from 'css-what';
import { GhostwrightError } from 'ghostwright';
import type {
	AsyncLocator,
	AsyncRegion,
	AsyncTerminal,
	ExtensionRevision,
	ExtensionSessionContext,
	RegisteredOscMessage,
	TerminalExtensionDefinition,
	TextLocatorOptions,
} from 'ghostwright';
import {
	FREEDOM_TTY_NAMESPACE,
	FREEDOM_TTY_OSC,
	type FreedomTtyFrameV1,
	type FreedomTtyNodeV1,
	type JsonScalar,
	type Rect,
} from './protocol.ts';

export * from './protocol.ts';

const LIMITS = {
	payload: 512 * 1024,
	nodes: 4096,
	key: 256,
	name: 256,
	attribute: 1024,
	depth: 128,
	selectorBytes: 4096,
	selectorTokens: 256,
	selectorBranches: 32,
	selectorDepth: 8,
	hasDepth: 2,
} as const;
const text = new TextDecoder('utf-8', { fatal: true });
const scalar = (value: unknown): value is JsonScalar =>
	value === null ||
	typeof value === 'string' ||
	typeof value === 'boolean' ||
	(typeof value === 'number' && Number.isFinite(value));
const fail = (code: string, message: string): never => {
	throw new GhostwrightError({ code, message: message.slice(0, 1024) });
};
const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

function decodeBase64url(payload: Uint8Array): unknown {
	const source = Buffer.from(payload).toString('ascii');
	if (!/^[A-Za-z0-9_-]*$/.test(source))
		fail('GW_SEMANTIC_BASE64', 'Semantic payload is not unpadded base64url');
	const decoded = (() => {
		try {
			return Buffer.from(source, 'base64url');
		} catch {
			return fail('GW_SEMANTIC_BASE64', 'Semantic payload cannot be decoded');
		}
	})();
	if (decoded.length > LIMITS.payload)
		fail('GW_SEMANTIC_LIMIT', 'Semantic payload exceeds decoded limit');
	try {
		return JSON.parse(text.decode(decoded));
	} catch {
		fail('GW_SEMANTIC_BASE64', 'Semantic payload is not UTF-8 JSON');
	}
}
function stringField(value: unknown, label: string, max: number): string {
	if (typeof value !== 'string') fail('GW_SEMANTIC_SCHEMA', `Invalid ${label}`);
	const stringValue = value as string;
	if (utf8Bytes(stringValue) > max) fail('GW_SEMANTIC_SCHEMA', `Invalid ${label}`);
	return stringValue;
}
function rect(
	value: unknown,
	floating: boolean,
): { x?: number; y?: number; width: number; height: number; column?: number; row?: number } {
	if (!value || typeof value !== 'object') fail('GW_SEMANTIC_SCHEMA', 'Invalid geometry rectangle');
	const data = value as Record<string, unknown>;
	const keys = floating ? ['x', 'y', 'width', 'height'] : ['column', 'row', 'width', 'height'];
	for (const key of keys)
		if (
			typeof data[key] !== 'number' ||
			!Number.isFinite(data[key]) ||
			(!floating && !Number.isInteger(data[key]))
		)
			fail('GW_SEMANTIC_SCHEMA', `Invalid geometry ${key}`);
	if ((data.width as number) < 0 || (data.height as number) < 0)
		fail('GW_SEMANTIC_SCHEMA', 'Geometry size must be nonnegative');
	return data as {
		x?: number;
		y?: number;
		width: number;
		height: number;
		column?: number;
		row?: number;
	};
}
function containsRect(outer: Rect, inner: Rect): boolean {
	return (
		inner.column >= outer.column &&
		inner.row >= outer.row &&
		inner.column + inner.width <= outer.column + outer.width &&
		inner.row + inner.height <= outer.row + outer.height
	);
}
function validateFrame(input: unknown): FreedomTtyFrameV1 {
	if (!input || typeof input !== 'object')
		fail('GW_SEMANTIC_SCHEMA', 'Semantic frame must be an object');
	const frame = input as Record<string, unknown>;
	if (frame.version !== 1) fail('GW_SEMANTIC_VERSION', 'Unsupported semantic protocol version');
	if (!Number.isSafeInteger(frame.frame) || (frame.frame as number) <= 0)
		fail('GW_SEMANTIC_SCHEMA', 'Invalid semantic frame number');
	const rawNodes = frame.nodes;
	if (!Array.isArray(rawNodes))
		fail('GW_SEMANTIC_LIMIT', 'Invalid or oversized semantic node list');
	const nodeValues = rawNodes as unknown[];
	if (nodeValues.length > LIMITS.nodes)
		fail('GW_SEMANTIC_LIMIT', 'Invalid or oversized semantic node list');
	const rawFocusStack = frame.focusStack;
	if (!Array.isArray(rawFocusStack) || !rawFocusStack.every((key) => typeof key === 'string'))
		fail('GW_SEMANTIC_SCHEMA', 'Invalid focus stack');
	const focusValues = rawFocusStack as string[];
	const surface = frame.renderSurface as Record<string, unknown>;
	if (
		!surface ||
		!Number.isInteger(surface.columns) ||
		!Number.isInteger(surface.rows) ||
		!Number.isInteger(surface.row) ||
		(surface.columns as number) <= 0 ||
		(surface.rows as number) <= 0 ||
		(surface.row as number) <= 0
	)
		fail('GW_SEMANTIC_SCHEMA', 'Invalid render surface');
	const seen = new Set<string>(),
		parents = new Map<string, string | null>(),
		nodes: FreedomTtyNodeV1[] = [];
	for (const raw of nodeValues) {
		if (!raw || typeof raw !== 'object') fail('GW_SEMANTIC_SCHEMA', 'Invalid semantic node');
		const node = raw as Record<string, unknown>,
			key = stringField(node.key, 'node key', LIMITS.key),
			name = stringField(node.name, 'node name', LIMITS.name);
		if (seen.has(key)) fail('GW_SEMANTIC_SCHEMA', 'Duplicate semantic node key');
		seen.add(key);
		if (node.parent !== null && typeof node.parent !== 'string')
			fail('GW_SEMANTIC_SCHEMA', 'Invalid parent');
		if (!Number.isInteger(node.order) || (node.order as number) < 0)
			fail('GW_SEMANTIC_SCHEMA', 'Invalid sibling order');
		const attributes = node.attributes as Record<string, unknown>,
			states = node.states as Record<string, unknown>;
		if (
			!attributes ||
			typeof attributes.focusable !== 'boolean' ||
			!states ||
			typeof states.focused !== 'boolean' ||
			typeof states.focusRoot !== 'boolean'
		)
			fail('GW_SEMANTIC_SCHEMA', 'Invalid semantic attributes or states');
		for (const key of ['role', 'label'])
			if (attributes[key] !== undefined) stringField(attributes[key], key, LIMITS.attribute);
		if (attributes.input !== undefined && typeof attributes.input !== 'boolean')
			fail('GW_SEMANTIC_SCHEMA', 'Invalid input attribute');
		const custom: Record<string, JsonScalar> = {};
		if (attributes.custom !== undefined) {
			if (
				!attributes.custom ||
				typeof attributes.custom !== 'object' ||
				Array.isArray(attributes.custom)
			)
				fail('GW_SEMANTIC_SCHEMA', 'Invalid custom attributes');
			for (const [customKey, customValue] of Object.entries(
				attributes.custom as Record<string, unknown>,
			)) {
				stringField(customKey, 'custom attribute name', LIMITS.key);
				if (!scalar(customValue)) fail('GW_SEMANTIC_SCHEMA', 'Invalid custom attribute value');
				if (typeof customValue === 'string' && utf8Bytes(customValue) > LIMITS.attribute)
					fail('GW_SEMANTIC_SCHEMA', 'Invalid custom attribute value');
				custom[customKey] = customValue as JsonScalar;
			}
		}
		let geometry: FreedomTtyNodeV1['geometry'];
		if (node.geometry !== undefined) {
			if (!node.geometry || typeof node.geometry !== 'object')
				fail('GW_SEMANTIC_SCHEMA', 'Invalid geometry');
			const rawGeometry = node.geometry as Record<string, unknown>,
				layoutBounds = rect(rawGeometry.layoutBounds, true),
				terminalBounds = rect(rawGeometry.terminalBounds, false);
			const visibleBounds =
				rawGeometry.visibleBounds === undefined
					? undefined
					: rect(rawGeometry.visibleBounds, false);
			if (visibleBounds) {
				const terminal = terminalBounds as Rect;
				const viewport: Rect = {
					column: 0,
					row: 0,
					width: surface.columns as number,
					height: surface.rows as number,
				};
				if (
					visibleBounds.width <= 0 ||
					visibleBounds.height <= 0 ||
					!containsRect(terminal, visibleBounds as Rect) ||
					!containsRect(viewport, visibleBounds as Rect)
				)
					fail('GW_SEMANTIC_SCHEMA', 'Visible bounds must be a nonempty viewport intersection');
			}
			geometry = Object.freeze({
				layoutBounds: layoutBounds as NonNullable<FreedomTtyNodeV1['geometry']>['layoutBounds'],
				terminalBounds: terminalBounds as Rect,
				...(visibleBounds ? { visibleBounds: visibleBounds as Rect } : {}),
			});
		}
		parents.set(key, node.parent as string | null);
		nodes.push(
			Object.freeze({
				key,
				name,
				parent: node.parent as string | null,
				order: node.order as number,
				attributes: Object.freeze({
					role: attributes.role as string | undefined,
					label: attributes.label as string | undefined,
					input: attributes.input as boolean | undefined,
					focusable: attributes.focusable as boolean,
					...(Object.keys(custom).length ? { custom: Object.freeze(custom) } : {}),
				}),
				states: Object.freeze({
					focused: states.focused as boolean,
					focusRoot: states.focusRoot as boolean,
				}),
				...(geometry ? { geometry } : {}),
			}),
		);
	}
	const siblingOrders = new Set<string>();
	for (const [key, parent] of parents) {
		if (parent && !parents.has(parent)) fail('GW_SEMANTIC_SCHEMA', `Missing parent for ${key}`);
		const node = nodes.find((candidate) => candidate.key === key)!;
		const orderKey = `${parent ?? '<root>'}:${node.order}`;
		if (siblingOrders.has(orderKey)) fail('GW_SEMANTIC_SCHEMA', 'Duplicate semantic sibling order');
		siblingOrders.add(orderKey);
		let cursor = parent,
			depth = 0;
		while (cursor) {
			if (cursor === key || ++depth > LIMITS.depth)
				fail('GW_SEMANTIC_SCHEMA', 'Semantic parent cycle or depth limit');
			cursor = parents.get(cursor) ?? null;
		}
	}
	if (nodes.filter((node) => node.parent === null).length !== 1)
		fail('GW_SEMANTIC_SCHEMA', 'Semantic frame must contain exactly one root');
	for (const key of focusValues)
		if (!seen.has(key)) fail('GW_SEMANTIC_SCHEMA', 'Focus stack references an unknown node');
	return Object.freeze({
		version: 1,
		frame: frame.frame as number,
		renderSurface: Object.freeze({
			columns: surface.columns as number,
			rows: surface.rows as number,
			row: surface.row as number,
		}),
		focusStack: Object.freeze([...focusValues]),
		nodes: Object.freeze(nodes),
	});
}

interface Element extends FreedomTtyNodeV1 {
	parentNode: Element | null;
	children: Element[];
}
function materialize(frame: FreedomTtyFrameV1): Element[] {
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
function attr(node: Element, name: string): string | undefined {
	if (name === 'id') return node.key;
	if (name === 'name') return node.name;
	const value =
		(node.attributes as Record<string, unknown>)[name] ?? node.attributes.custom?.[name];
	return value === undefined ? undefined : String(value);
}
const adapter: NonNullable<Options<Element, Element>['adapter']> = {
	isTag: (node): node is Element => !!node,
	getName: (node) => node.name || 'freedom-root',
	getChildren: (node) => node.children,
	getParent: (node) => node.parentNode,
	getSiblings: (node) => node.parentNode?.children ?? [node],
	prevElementSibling: (node) => {
		const siblings = node.parentNode?.children ?? [node],
			index = siblings.indexOf(node);
		return index > 0 ? (siblings[index - 1] ?? null) : null;
	},
	getAttributeValue: attr,
	hasAttrib: (node, name) => attr(node, name) !== undefined,
	getText: (node) =>
		[node.attributes.label ?? '', ...node.children.map((child) => adapter.getText(child))]
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
		visible: (node) => !!node.geometry?.visibleBounds,
	},
};
const allowed = new Set([
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
	'only-of-type',
	'nth-child',
	'nth-last-child',
	'nth-of-type',
	'nth-last-of-type',
	'focus',
	'focus-root',
	'visible',
]);
function selector(source: string): Selector[][] {
	if (utf8Bytes(source) > LIMITS.selectorBytes)
		fail('GW_SEMANTIC_SELECTOR_LIMIT', `Selector exceeds ${LIMITS.selectorBytes} bytes`);
	let ast: Selector[][] = [];
	try {
		ast = parse(source);
	} catch {
		fail('GW_SEMANTIC_SELECTOR_INVALID', 'Malformed semantic selector');
	}
	let tokens = 0,
		branches = 0;
	const visit = (lists: Selector[][], depth: number, hasDepth: number) => {
		if (depth > LIMITS.selectorDepth)
			fail('GW_SEMANTIC_SELECTOR_LIMIT', 'Selector nesting exceeds limit');
		branches += lists.length;
		if (branches > LIMITS.selectorBranches)
			fail('GW_SEMANTIC_SELECTOR_LIMIT', 'Selector list exceeds limit');
		for (const list of lists)
			for (const token of list) {
				if (++tokens > LIMITS.selectorTokens)
					fail('GW_SEMANTIC_SELECTOR_LIMIT', 'Selector token limit exceeded');
				if (token.type === SelectorType.PseudoElement)
					fail('GW_SEMANTIC_SELECTOR_UNSUPPORTED', 'Pseudo-elements are not supported');
				if (token.type === SelectorType.Parent || token.type === SelectorType.ColumnCombinator)
					fail(
						'GW_SEMANTIC_SELECTOR_UNSUPPORTED',
						`Selector traversal ${token.type} is not supported`,
					);
				if (token.type === SelectorType.Attribute && token.action === AttributeAction.Not)
					fail(
						'GW_SEMANTIC_SELECTOR_UNSUPPORTED',
						'The nonstandard != attribute operator is not supported',
					);
				if (token.type === SelectorType.Pseudo) {
					if (!allowed.has(token.name))
						fail(
							'GW_SEMANTIC_SELECTOR_UNSUPPORTED',
							`Pseudo-class :${token.name} is not supported`,
						);
					if (token.name === 'has' && hasDepth >= LIMITS.hasDepth)
						fail('GW_SEMANTIC_SELECTOR_LIMIT', `Nested :has() exceeds depth ${LIMITS.hasDepth}`);
					if (Array.isArray(token.data))
						visit(token.data, depth + 1, token.name === 'has' ? hasDepth + 1 : hasDepth);
				}
			}
	};
	visit(ast, 0, 0);
	return ast;
}

export class FreedomTtyLocator {
	readonly #predicate: (node: Element) => boolean;
	readonly session: FreedomTtySession;
	readonly source: string;
	readonly index: number | undefined;
	constructor(session: FreedomTtySession, source: string, index?: number) {
		this.session = session;
		this.source = source;
		this.index = index;
		this.#predicate = compile(selector(source), options);
	}
	matches(): readonly FreedomTtyNodeV1[] {
		const nodes = this.session.document();
		const values = nodes.filter(this.#predicate);
		const selected =
			this.index === undefined ? values : values[this.index] ? [values[this.index]!] : [];
		return Object.freeze(selected);
	}
	unique(): FreedomTtyNodeV1 {
		return this.#one();
	}
	bounds(): Rect | undefined {
		return this.visibleBounds();
	}
	nth(index: number): FreedomTtyLocator {
		if (!Number.isSafeInteger(index) || index < 0)
			fail('GW_SEMANTIC_LOCATOR_RANGE', 'Locator index must be a nonnegative safe integer');
		return new FreedomTtyLocator(this.session, this.source, index);
	}
	#one(): FreedomTtyNodeV1 {
		const matches = this.matches();
		if (matches.length !== 1)
			fail(
				'GW_SEMANTIC_LOCATOR_STRICT',
				`Selector ${JSON.stringify(this.source)} matched ${matches.length}: ${matches
					.slice(0, 20)
					.map((node) => `${node.key}/${node.name}`)
					.join(', ')}`,
			);
		return matches[0]!;
	}
	layoutBounds() {
		return this.#one().geometry?.layoutBounds;
	}
	terminalBounds() {
		return this.#one().geometry?.terminalBounds;
	}
	visibleBounds() {
		return this.#one().geometry?.visibleBounds;
	}
	#regionBounds(): Rect {
		const node = this.#one();
		const geometry = node.geometry;
		if (!geometry)
			return fail(
				'GW_SEMANTIC_NO_GEOMETRY',
				`Selector ${JSON.stringify(this.source)} matched ${node.key}/${node.name} without geometry`,
			);
		const visibleBounds = geometry.visibleBounds;
		if (!visibleBounds)
			return fail(
				'GW_SEMANTIC_NOT_VISIBLE',
				`Selector ${JSON.stringify(this.source)} matched ${node.key}/${node.name} without visible cells`,
			);
		return visibleBounds;
	}
	region(): AsyncRegion {
		return this.session.terminal.region(this.#regionBounds());
	}
	getByText(textValue: string, textOptions?: TextLocatorOptions): AsyncLocator {
		return this.region().getByText(textValue, textOptions);
	}
	click() {
		const bounds = this.#regionBounds();
		return this.session.terminal.mouse.click({
			column: bounds.column + Math.floor(bounds.width / 2),
			row: bounds.row + Math.floor(bounds.height / 2),
		});
	}
	containsCursor(): boolean {
		const bounds = this.#regionBounds(),
			cursor = this.session.terminal.screen.current().cursor;
		return (
			cursor.column >= bounds.column &&
			cursor.column < bounds.column + bounds.width &&
			cursor.row >= bounds.row &&
			cursor.row < bounds.row + bounds.height
		);
	}
}

export class FreedomTtySession {
	#current?: FreedomTtyFrameV1;
	#revisions: ExtensionRevision<FreedomTtyFrameV1>[] = [];
	#documentFrame = -1;
	#document: Element[] = [];
	readonly terminal: AsyncTerminal;
	constructor(terminal: AsyncTerminal) {
		this.terminal = terminal;
	}
	validateNext(frame: FreedomTtyFrameV1) {
		if (this.#current && frame.frame <= this.#current.frame)
			fail('GW_SEMANTIC_FRAME_ORDER', 'Semantic frame numbers must increase');
	}
	setCurrent(frame: FreedomTtyFrameV1) {
		this.#current = frame;
		this.#documentFrame = -1;
	}
	record(revision: ExtensionRevision<FreedomTtyFrameV1>) {
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
	locator(source: string) {
		return new FreedomTtyLocator(this, source);
	}
}

export function freedomTtyExtension(): TerminalExtensionDefinition<
	FreedomTtySession,
	FreedomTtyFrameV1
> {
	return {
		id: 'ghostwright.freedom-tty',
		osc: {
			number: FREEDOM_TTY_OSC,
			namespace: FREEDOM_TTY_NAMESPACE,
			maxBufferedBytes: 1024 * 1024,
			decode(message: RegisteredOscMessage) {
				if (message.parameters.length !== 1 || message.parameters[0] !== 'v=1')
					fail('GW_SEMANTIC_VERSION', 'Unsupported semantic envelope version');
				return validateFrame(decodeBase64url(message.payload));
			},
		},
		createSession(context: ExtensionSessionContext<FreedomTtyFrameV1>) {
			return new FreedomTtySession(context.terminal);
		},
		accept(
			session: FreedomTtySession,
			frame: FreedomTtyFrameV1,
			context: ExtensionSessionContext<FreedomTtyFrameV1>,
		) {
			session.validateNext(frame);
			session.setCurrent(frame);
			const revision = context.publish({ protocolFrame: frame.frame, value: frame });
			session.record(revision);
		},
	};
}

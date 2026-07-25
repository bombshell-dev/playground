// oxlint-disable bombshell-dev/exported-function-async -- pure synchronous snapshot queries
import { compile, type Options } from 'css-select';
import { AttributeAction, parse, SelectorType, type Selector } from 'css-what';
import type {
	AsyncLocator,
	AsyncRegion,
	AsyncTerminal,
	Rect,
	TextLocatorOptions,
} from 'ghostwright';

const PREFIX = '\u001b]7777;ghostwright.freedom-tty;v=',
	MAX_SELECTOR_BYTES = 4096,
	MAX_SELECTOR_TOKENS = 256,
	MAX_SELECTOR_LISTS = 32,
	MAX_SELECTOR_DEPTH = 8,
	MAX_HAS_DEPTH = 2;

export interface FreedomTtyNodeMetadata {
	key: string;
	name: string;
	parent: string | null;
	order: number;
	rect?: [x: number, y: number, width: number, height: number];
	attributes: {
		role?: string;
		label?: string;
		input?: boolean;
		focusable: boolean;
	};
	states: {
		focused: boolean;
		focusRoot: boolean;
	};
}

export interface FreedomTtyFrameMetadata {
	version: number;
	frame: number;
	focusStack: string[];
	nodes: FreedomTtyNodeMetadata[];
}

/** Selector syntax, complexity, or strictness error from the spike extension. */
export class FreedomTtyLocatorError extends Error {
	readonly code = 'FREEDOM_TTY_LOCATOR';
}

function asRect(rect: FreedomTtyNodeMetadata['rect']): Rect | undefined {
	if (!rect || !rect.every(Number.isFinite)) return undefined;
	const [x, y, width, height] = rect;
	return {
		column: Math.floor(x),
		row: Math.floor(y),
		width: Math.ceil(width),
		height: Math.ceil(height),
	};
}

/** Parse every complete Freedom+tty metadata frame in an accumulated PTY stream. */
export function parseFreedomTtyFrames(bytes: Uint8Array): FreedomTtyFrameMetadata[] {
	const raw = Buffer.from(bytes).toString('latin1'),
		frames: FreedomTtyFrameMetadata[] = [];
	let offset = 0;
	for (;;) {
		const start = raw.indexOf(PREFIX, offset);
		if (start < 0) break;
		const bodyStart = start + PREFIX.length,
			st = raw.indexOf('\u001b\\', bodyStart),
			bel = raw.indexOf('\u0007', bodyStart),
			end = st < 0 ? bel : bel < 0 ? st : Math.min(st, bel);
		if (end < 0) break;
		const body = raw.slice(bodyStart, end),
			separator = body.indexOf(';');
		if (separator > 0) {
			const envelopeVersion = Number(body.slice(0, separator));
			try {
				const frame = JSON.parse(
					Buffer.from(body.slice(separator + 1), 'base64url').toString('utf8'),
				) as FreedomTtyFrameMetadata;
				if (
					frame.version === envelopeVersion &&
					Number.isInteger(frame.frame) &&
					Array.isArray(frame.nodes)
				)
					frames.push(frame);
			} catch {
				// A production extension should retain a protocol diagnostic. The
				// spike ignores malformed frames and keeps the latest complete one.
			}
		}
		offset = end + (end === st ? 2 : 1);
	}
	return frames;
}

interface SelectorNode extends FreedomTtyNodeMetadata {
	parentNode: SelectorNode | null;
	children: SelectorNode[];
}

interface SelectorDocument {
	nodes: SelectorNode[];
	roots: SelectorNode[];
}

function materialize(frame: FreedomTtyFrameMetadata): SelectorDocument {
	const nodes: SelectorNode[] = frame.nodes.map((node) => ({
		...node,
		parentNode: null,
		children: [],
	}));
	const byKey = new Map(nodes.map((node) => [node.key, node])),
		roots: SelectorNode[] = [];
	for (const node of nodes) {
		const parent = node.parent ? byKey.get(node.parent) : undefined;
		if (parent) {
			node.parentNode = parent;
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}
	for (const node of nodes) node.children.sort((left, right) => left.order - right.order);
	return { nodes, roots };
}

function attributeValue(node: SelectorNode, name: string): string | undefined {
	if (name === 'id') return node.key;
	if (name === 'name') return node.name;
	if (name === 'focused') return String(node.states.focused);
	if (name === 'focus-root') return String(node.states.focusRoot);
	const value = (node.attributes as Readonly<Record<string, unknown>>)[name];
	return value === undefined ? undefined : String(value);
}

function textContent(node: SelectorNode): string {
	return [node.attributes.label ?? '', ...node.children.map(textContent)].filter(Boolean).join(' ');
}

const adapter: NonNullable<Options<SelectorNode, SelectorNode>['adapter']> = {
	isTag: (node): node is SelectorNode => !!node,
	getName: (node) => node.name || 'freedom-root',
	getChildren: (node) => node.children,
	getParent: (node) => node.parentNode,
	getSiblings: (node) => node.parentNode?.children ?? [node],
	prevElementSibling: (node) => {
		const siblings = node.parentNode?.children ?? [node],
			index = siblings.indexOf(node);
		return index > 0 ? siblings[index - 1] : null;
	},
	getAttributeValue: attributeValue,
	hasAttrib: (node, name) => attributeValue(node, name) !== undefined,
	getText: textContent,
	removeSubsets: (nodes) => {
		const selected = new Set(nodes);
		return nodes.filter((node) => {
			for (let parent = node.parentNode; parent; parent = parent.parentNode)
				if (selected.has(parent)) return false;
			return true;
		});
	},
	equals: (left, right) => left.key === right.key,
};

const selectorOptions: Options<SelectorNode, SelectorNode> = {
	adapter,
	xmlMode: true,
	cacheResults: false,
	pseudos: {
		focus: (node) => node.states.focused,
		'focus-root': (node) => node.states.focusRoot,
		visible: (node) => !!node.rect && node.rect[2] > 0 && node.rect[3] > 0,
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
	'first-of-type',
	'last-of-type',
	'only-child',
	'only-of-type',
	'nth-child',
	'nth-last-child',
	'nth-of-type',
	'nth-last-of-type',
	'focus',
	'focus-root',
	'visible',
]);

/** Parse and enforce the selector subset and complexity limits owned by this extension. */
function validateSelector(source: string): Selector[][] {
	if (Buffer.byteLength(source, 'utf8') > MAX_SELECTOR_BYTES)
		throw new FreedomTtyLocatorError(`Selector exceeds ${MAX_SELECTOR_BYTES} bytes`);
	let ast: Selector[][];
	try {
		ast = parse(source);
	} catch (error) {
		throw new FreedomTtyLocatorError(
			`Invalid selector ${JSON.stringify(source)}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	let tokens = 0,
		lists = 0;
	function visit(selectors: Selector[][], state: { depth: number; hasDepth: number }): void {
		const { depth, hasDepth } = state;
		if (depth > MAX_SELECTOR_DEPTH)
			throw new FreedomTtyLocatorError(`Selector nesting exceeds ${MAX_SELECTOR_DEPTH}`);
		lists += selectors.length;
		if (lists > MAX_SELECTOR_LISTS)
			throw new FreedomTtyLocatorError(`Selector lists exceed ${MAX_SELECTOR_LISTS}`);
		for (const selector of selectors) {
			for (const token of selector) {
				if (++tokens > MAX_SELECTOR_TOKENS)
					throw new FreedomTtyLocatorError(`Selector tokens exceed ${MAX_SELECTOR_TOKENS}`);
				if (token.type === SelectorType.PseudoElement)
					throw new FreedomTtyLocatorError('Pseudo-elements are not supported');
				if (token.type === SelectorType.Parent || token.type === SelectorType.ColumnCombinator)
					throw new FreedomTtyLocatorError(`Selector traversal ${token.type} is not supported`);
				if (token.type === SelectorType.Attribute && token.action === AttributeAction.Not)
					throw new FreedomTtyLocatorError(
						'The nonstandard != attribute operator is not supported',
					);
				if (token.type === SelectorType.Pseudo) {
					if (!allowedPseudos.has(token.name))
						throw new FreedomTtyLocatorError(`Pseudo-class :${token.name} is not supported`);
					if (token.name === 'has' && hasDepth >= MAX_HAS_DEPTH)
						throw new FreedomTtyLocatorError(`Nested :has() exceeds depth ${MAX_HAS_DEPTH}`);
					if (Array.isArray(token.data))
						visit(token.data, {
							depth: depth + 1,
							hasDepth: token.name === 'has' ? hasDepth + 1 : hasDepth,
						});
				}
			}
		}
	}
	visit(ast, { depth: 0, hasDepth: 0 });
	return ast;
}

/** Lazy CSS locator that re-runs a compiled selector against the newest semantic frame. */
export class FreedomTtyLocator {
	readonly selector: string;
	readonly index: number | undefined;
	readonly #predicate: (node: SelectorNode) => boolean;

	constructor(
		readonly extension: FreedomTtyExtension,
		options: { selector: string; index?: number },
	) {
		this.selector = options.selector;
		this.index = options.index;
		this.#predicate = compile<SelectorNode, SelectorNode>(
			validateSelector(this.selector),
			selectorOptions,
		);
	}

	matches(): readonly FreedomTtyNodeMetadata[] {
		const document = this.extension.document();
		if (!document) return [];
		const matches = document.nodes.filter(this.#predicate);
		return this.index === undefined ? matches : matches[this.index] ? [matches[this.index]] : [];
	}

	nth(index: number): FreedomTtyLocator {
		if (!Number.isInteger(index) || index < 0)
			throw new FreedomTtyLocatorError('Locator index must be a nonnegative integer');
		return new FreedomTtyLocator(this.extension, { selector: this.selector, index });
	}

	unique(): FreedomTtyNodeMetadata {
		const matches = this.matches();
		if (matches.length !== 1)
			throw new FreedomTtyLocatorError(
				`Selector ${JSON.stringify(this.selector)} matched ${matches.length} semantic nodes`,
			);
		return matches[0];
	}

	bounds(): Rect | undefined {
		return asRect(this.unique().rect);
	}

	region(): AsyncRegion {
		const bounds = this.bounds();
		if (!bounds)
			throw new FreedomTtyLocatorError(
				`Selector ${JSON.stringify(this.selector)} matched a node without Clay geometry`,
			);
		return this.extension.terminal.region(bounds);
	}

	getByText(text: string, options?: TextLocatorOptions): AsyncLocator {
		return this.region().getByText(text, options);
	}

	containsCursor(): boolean {
		const bounds = this.bounds();
		if (!bounds) return false;
		const { cursor } = this.extension.terminal.screen.snapshot();
		return (
			cursor.column >= bounds.column &&
			cursor.column < bounds.column + bounds.width &&
			cursor.row >= bounds.row &&
			cursor.row < bounds.row + bounds.height
		);
	}
}

/** Minimal stand-in for a Ghostwright semantic-tree extension instance. */
export class FreedomTtyExtension {
	#rawLength = -1;
	#frames: readonly FreedomTtyFrameMetadata[] = [];
	#documentFrame = -1;
	#document: SelectorDocument | undefined;

	constructor(readonly terminal: AsyncTerminal) {}

	frames(): readonly FreedomTtyFrameMetadata[] {
		const raw = this.terminal.screen.rawOutput();
		if (raw.length !== this.#rawLength) {
			this.#rawLength = raw.length;
			this.#frames = parseFreedomTtyFrames(raw);
		}
		return this.#frames;
	}

	current(): FreedomTtyFrameMetadata | undefined {
		return this.frames().at(-1);
	}

	document(): SelectorDocument | undefined {
		const frame = this.current();
		if (!frame) return undefined;
		if (frame.frame !== this.#documentFrame) {
			this.#documentFrame = frame.frame;
			this.#document = materialize(frame);
		}
		return this.#document;
	}

	locator(selector: string): FreedomTtyLocator {
		return new FreedomTtyLocator(this, { selector });
	}
}

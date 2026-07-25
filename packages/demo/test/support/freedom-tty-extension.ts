// oxlint-disable bombshell-dev/exported-function-async -- pure synchronous snapshot queries
import type {
	AsyncLocator,
	AsyncRegion,
	AsyncTerminal,
	Rect,
	TextLocatorOptions,
} from 'ghostwright';

const PREFIX = '\u001b]7777;ghostwright.freedom-tty;v=';

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

/** Selector syntax or strictness error from the spike extension. */
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

interface CompoundSelector {
	name?: string;
	id?: string;
	attributes: Array<{ name: string; value?: string }>;
	pseudos: Array<'focus' | 'focus-root' | 'root'>;
}

type Combinator = 'child' | 'descendant';

interface ParsedSelector {
	compounds: CompoundSelector[];
	combinators: Combinator[];
}

function parseCompound(source: string): CompoundSelector {
	const result: CompoundSelector = { attributes: [], pseudos: [] };
	let rest = source;
	const name = /^(\*|[A-Za-z_][A-Za-z0-9_-]*)/.exec(rest);
	if (name) {
		if (name[1] !== '*') result.name = name[1];
		rest = rest.slice(name[0].length);
	}
	while (rest) {
		const id = /^#([A-Za-z0-9_-]+)/.exec(rest);
		if (id) {
			result.id = id[1];
			rest = rest.slice(id[0].length);
			continue;
		}
		const pseudo = /^:(focus-root|focus|root)/.exec(rest);
		if (pseudo) {
			result.pseudos.push(pseudo[1] as CompoundSelector['pseudos'][number]);
			rest = rest.slice(pseudo[0].length);
			continue;
		}
		const attribute = /^\[([A-Za-z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/.exec(rest);
		if (attribute) {
			result.attributes.push({
				name: attribute[1],
				value: attribute[2] ?? attribute[3] ?? attribute[4]?.trim(),
			});
			rest = rest.slice(attribute[0].length);
			continue;
		}
		throw new FreedomTtyLocatorError(`Unsupported selector syntax near ${JSON.stringify(rest)}`);
	}
	return result;
}

function parseSelector(source: string): ParsedSelector {
	const normalized = source.trim().replace(/\s*>\s*/g, '>');
	if (!normalized) throw new FreedomTtyLocatorError('Selector cannot be empty');
	const compounds: CompoundSelector[] = [],
		combinators: Combinator[] = [];
	let token = '';
	for (let index = 0; index < normalized.length; index++) {
		const char = normalized[index];
		if (char === '>' || /\s/.test(char)) {
			if (!token) continue;
			compounds.push(parseCompound(token));
			token = '';
			combinators.push(char === '>' ? 'child' : 'descendant');
			while (/\s/.test(normalized[index + 1] ?? '')) index++;
		} else {
			token += char;
		}
	}
	if (token) compounds.push(parseCompound(token));
	if (compounds.length === 0 || combinators.length !== compounds.length - 1)
		throw new FreedomTtyLocatorError(`Malformed selector ${JSON.stringify(source)}`);
	return { compounds, combinators };
}

function attributeValue(node: FreedomTtyNodeMetadata, name: string): unknown {
	if (name === 'name') return node.name;
	if (name === 'focused') return node.states.focused;
	if (name === 'focus-root') return node.states.focusRoot;
	return node.attributes[name as keyof FreedomTtyNodeMetadata['attributes']];
}

function matchesCompound(node: FreedomTtyNodeMetadata, selector: CompoundSelector): boolean {
	if (selector.name && node.name !== selector.name) return false;
	if (selector.id && node.key !== selector.id) return false;
	for (const pseudo of selector.pseudos) {
		if (pseudo === 'focus' && !node.states.focused) return false;
		if (pseudo === 'focus-root' && !node.states.focusRoot) return false;
		if (pseudo === 'root' && node.parent !== null) return false;
	}
	for (const attribute of selector.attributes) {
		const actual = attributeValue(node, attribute.name);
		if (actual === undefined) return false;
		if (attribute.value !== undefined && String(actual) !== attribute.value) return false;
	}
	return true;
}

function query(frame: FreedomTtyFrameMetadata, source: string): FreedomTtyNodeMetadata[] {
	const selector = parseSelector(source),
		byKey = new Map(frame.nodes.map((node) => [node.key, node]));

	function matchesAt(node: FreedomTtyNodeMetadata, index: number): boolean {
		if (!matchesCompound(node, selector.compounds[index])) return false;
		if (index === 0) return true;
		const combinator = selector.combinators[index - 1];
		let parent = node.parent ? byKey.get(node.parent) : undefined;
		if (combinator === 'child') return !!parent && matchesAt(parent, index - 1);
		while (parent) {
			if (matchesAt(parent, index - 1)) return true;
			parent = parent.parent ? byKey.get(parent.parent) : undefined;
		}
		return false;
	}

	return frame.nodes.filter((node) => matchesAt(node, selector.compounds.length - 1));
}

/** Lazy CSS-like locator that re-resolves against the latest semantic frame. */
export class FreedomTtyLocator {
	readonly selector: string;
	readonly index: number | undefined;

	constructor(
		readonly extension: FreedomTtyExtension,
		options: { selector: string; index?: number },
	) {
		this.selector = options.selector;
		this.index = options.index;
		parseSelector(this.selector);
	}

	matches(): readonly FreedomTtyNodeMetadata[] {
		const frame = this.extension.current();
		if (!frame) return [];
		const matches = query(frame, this.selector);
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
	constructor(readonly terminal: AsyncTerminal) {}

	frames(): readonly FreedomTtyFrameMetadata[] {
		return parseFreedomTtyFrames(this.terminal.screen.rawOutput());
	}

	current(): FreedomTtyFrameMetadata | undefined {
		return this.frames().at(-1);
	}

	locator(selector: string): FreedomTtyLocator {
		return new FreedomTtyLocator(this, { selector });
	}
}

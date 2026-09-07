import { compile, type Options } from 'css-select';
import { AttributeAction, parse, SelectorType, type Selector } from 'css-what';
import {
	defineLocator,
	GhostwrightError,
	InvalidOptionsError,
	type RegionLocator,
	type TerminalExtensionDefinition,
} from 'ghostwright';
import {
	CLACK_TTY_NAMESPACE,
	CLACK_TTY_OSC,
	decodeFrame,
	type ClackFrame,
	type ClackNode,
} from './protocol.ts';

const ID = 'ghostwright.clack-tty';
const fail = (code: string, message: string): never => {
	throw new GhostwrightError({ code, message });
};
interface Element extends ClackNode {
	parentNode: Element | null;
	children: Element[];
}
function materialize(frame: ClackFrame): Element[] {
	const nodes: Element[] = frame.nodes.map((node) => ({ ...node, parentNode: null, children: [] }));
	const byKey = new Map(nodes.map((node) => [node.key, node]));
	for (const node of nodes) {
		const parent = node.parent === null ? undefined : byKey.get(node.parent);
		if (parent) {
			node.parentNode = parent;
			parent.children.push(node);
		}
	}
	const ordered: Element[] = [];
	function visit(siblings: Element[]): void {
		siblings.sort((a, b) => a.order - b.order);
		for (const node of siblings) {
			ordered.push(node);
			visit(node.children);
		}
	}
	visit(nodes.filter((node) => !node.parentNode));
	return ordered;
}
function attribute(node: Element, name: string): string | undefined {
	if (name === 'id') return node.key;
	if (name === 'input') return node.attrs.input ? 'true' : undefined;
	const customKey = name === 'type' ? 'type' : name.startsWith('data-') ? name.slice(5) : undefined;
	const custom = node.attrs.custom;
	const value =
		name === 'role'
			? node.attrs.role
			: name === 'label'
				? node.attrs.label
				: customKey !== undefined && custom && Object.hasOwn(custom, customKey)
					? custom[customKey]
					: undefined;
	return value === undefined ? undefined : String(value);
}
const adapter: NonNullable<Options<Element, Element>['adapter']> = {
	isTag: (node): node is Element => !!node,
	getName: (node) => node.name,
	getChildren: (node) => node.children,
	getParent: (node) => node.parentNode,
	getSiblings: (node) => node.parentNode?.children ?? [node],
	prevElementSibling(node) {
		const siblings = node.parentNode?.children ?? [node];
		return siblings[siblings.indexOf(node) - 1] ?? null;
	},
	getAttributeValue: attribute,
	hasAttrib: (node, name) => attribute(node, name) !== undefined,
	getText: (node) =>
		[node.attrs.label ?? '', ...node.children.map((child) => adapter.getText(child))].join(' '),
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
]);
function selector(source: string): Selector[][] {
	if (new TextEncoder().encode(source).length > 4096)
		fail('GW_CLACK_SELECTOR_LIMIT', 'Selector exceeds 4096 bytes');
	let ast: Selector[][];
	try {
		ast = parse(source);
	} catch {
		return fail('GW_CLACK_SELECTOR_INVALID', 'Malformed selector');
	}
	let tokens = 0,
		branches = 0;
	// oxlint-disable-next-line bombshell-dev/max-params -- traversal tracks independent selector depth limits
	function visit(lists: Selector[][], depth: number, hasDepth: number): void {
		branches += lists.length;
		if (depth > 8 || branches > 32)
			fail('GW_CLACK_SELECTOR_LIMIT', 'Selector nesting/list limit exceeded');
		for (const list of lists)
			for (const token of list) {
				if (++tokens > 256) fail('GW_CLACK_SELECTOR_LIMIT', 'Selector token limit exceeded');
				if (
					token.type === SelectorType.PseudoElement ||
					token.type === SelectorType.Parent ||
					token.type === SelectorType.ColumnCombinator
				)
					fail('GW_CLACK_SELECTOR_INVALID', 'Unsupported selector traversal');
				if (
					token.type === SelectorType.Attribute &&
					(token.action === AttributeAction.Not ||
						['focused', 'focusable', 'focus-root', 'visible'].includes(token.name))
				)
					fail(
						'GW_CLACK_SELECTOR_INVALID',
						'State selectors are not terminal evidence; use a matcher',
					);
				if (token.type === SelectorType.Pseudo) {
					if (!allowedPseudos.has(token.name))
						fail(
							'GW_CLACK_SELECTOR_INVALID',
							`Unsupported pseudo-class :${token.name}; use terminal matchers for visual state`,
						);
					if (token.name === 'has' && hasDepth >= 2)
						fail('GW_CLACK_SELECTOR_LIMIT', 'Nested :has exceeds limit');
					if (Array.isArray(token.data))
						visit(token.data, depth + 1, hasDepth + (token.name === 'has' ? 1 : 0));
				}
			}
	}
	visit(ast, 0, 0);
	return ast;
}

/** DOM queries retain node identity until the final region is inspected. */
export interface ClackLocator extends RegionLocator {
	/** Search strict descendants of the current matches, not their cell bounds. */
	locator(source: string): ClackLocator;
	nth(index: number): ClackLocator;
}

const selectorOptions: Options<Element, Element> = { adapter, xmlMode: true, cacheResults: false };
type NodeQuery = (document: readonly Element[]) => readonly Element[];

function treeLocator(source: string, select: NodeQuery): ClackLocator {
	const regions = defineLocator<ClackFrame>(ID, source, (frame) =>
		select(materialize(frame)).map((node) => {
			if (!node.geo)
				return fail('GW_CLACK_NO_GEOMETRY', `${source}: ${node.key}/${node.name} has no geometry`);
			return node.geo.term;
		}),
	);
	return Object.freeze({
		...regions,
		nth(index: number): ClackLocator {
			if (!Number.isSafeInteger(index) || index < 0)
				throw new InvalidOptionsError('Locator index must be nonnegative');
			return treeLocator(`${source}.nth(${index})`, (document) =>
				select(document).slice(index, index + 1),
			);
		},
		locator(childSource: string): ClackLocator {
			// Validate at construction, including selector expressions that fail compilation.
			compile(selector(childSource), selectorOptions);
			return treeLocator(`${source} >> ${childSource}`, (document) => {
				const parents = select(document);
				if (!parents.length) return [];
				const roots = new Set(parents);
				// css-select binds :scope/relative selectors to these nodes and mutates
				// parsed tokens. Compile fresh tokens for this observation's context.
				const matches = compile(childSource, selectorOptions, [...parents]);
				return document.filter((node) => {
					if (!matches(node)) return false;
					for (let ancestor = node.parentNode; ancestor; ancestor = ancestor.parentNode) {
						if (roots.has(ancestor)) return true;
					}
					return false;
				});
			});
		},
	});
}

/** Construct a reusable, session-free query. Resolution never reads a live UI. */
export function locator(source: string): ClackLocator {
	const predicate = compile(selector(source), selectorOptions);
	return treeLocator(source, (document) => document.filter(predicate));
}

/** Pure decoder shared by live sessions and replay. */
export function clackTtyExtension(): TerminalExtensionDefinition<ClackFrame> {
	return {
		id: ID,
		osc: {
			number: CLACK_TTY_OSC,
			namespace: CLACK_TTY_NAMESPACE,
			maxBufferedBytes: 1024 * 1024,
			decode(message) {
				if (message.parameters.length !== 1 || message.parameters[0] !== 'v=1')
					fail('GW_CLACK_VERSION', 'Unsupported envelope version');
				const frame = decodeFrame(message.payload);
				return { protocolFrame: frame.frame, value: frame };
			},
		},
	};
}

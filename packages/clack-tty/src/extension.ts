import { compile, type Options } from 'css-select';
import { AttributeAction, parse, SelectorType, type Selector } from 'css-what';
import { defineLocator, GhostwrightError, type TerminalExtensionDefinition } from 'ghostwright';
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
	function visit(siblings: Element[]) {
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
	function visit(lists: Selector[][], depth: number, hasDepth: number) {
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

/** Construct a reusable, session-free query. Resolution never reads a live UI. */
export function locator(source: string) {
	const predicate = compile(selector(source), { adapter, xmlMode: true, cacheResults: false });
	return defineLocator<ClackFrame>(ID, source, (frame) =>
		materialize(frame)
			.filter(predicate)
			.map((node) => {
				if (!node.geo)
					return fail(
						'GW_CLACK_NO_GEOMETRY',
						`${source}: ${node.key}/${node.name} has no geometry`,
					);
				return node.geo.term; // Preserve original edges. Core inspection handles viewport clipping.
			}),
	);
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

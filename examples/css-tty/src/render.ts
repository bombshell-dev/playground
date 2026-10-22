// Bridge: computed declarations → `@bomb.sh/tty` render ops.
//
// `@bomb.sh/css` resolves the stylesheet per node; this file turns each
// node's computed style into Clay render ops, so the terminal draws what
// the CSS says. The mapping conventions:
//
// - `width`/`height` percentages fill the parent (`100%` → percent(1));
//   `flex: 1` grows a box to share the free space with its siblings.
// - `flex-direction: row|column` picks the main axis (`ltr`/`ttb`).
// - `gap`/`padding`/`border` lengths map to cells: the demo's cell metric
//   is 8×16 CSS px, and the quantities involved are small enough to read
//   as cells.
// - `border: <n>px` with a `border-color` draws an n-cell border.
// - `color` paints text, `background-color` paints the element's cells.
//
// Colors arrive canonicalized (`#rgb`, `#rrggbb`); lengths arrive as
// canonical text like `2px` or `100%`.
import { close, open, rgba, text, type OpenElement, type Op } from '@bomb.sh/tty';
import type { ComputedProperty, CssNode } from '@bomb.sh/css';
import { NO_PARENT } from '@bomb.sh/css';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/// Canonical engine color text → packed rgba for the render ops.
export function colorOf(value: string | undefined): number | undefined {
	const match = HEX.exec(value?.trim() ?? '');
	if (!match) {
		return undefined;
	}
	let hex = match[1]!;
	if (hex.length === 3) {
		hex = [...hex].map((c) => c + c).join('');
	}
	return rgba(
		parseInt(hex.slice(0, 2), 16),
		parseInt(hex.slice(2, 4), 16),
		parseInt(hex.slice(4, 6), 16),
	);
}

/// A canonical length (`2px`) → cells. Percentages are handled separately
/// by the sizing rules.
function cells(value: string | undefined): number | undefined {
	const match = /^(\d+(?:\.\d+)?)px$/.exec(value?.trim() ?? '');
	return match ? Number(match[1]) : undefined;
}

/// `100%` → 1 (Clay percentages are 0..1).
function fraction(value: string | undefined): number | undefined {
	const match = /^(\d+(?:\.\d+)?)%$/.exec(value?.trim() ?? '');
	return match ? Number(match[1]) / 100 : undefined;
}

type Declarations = Record<string, string>;

const declarationsOf = (computed: ComputedProperty[]): Declarations => Object.fromEntries(computed);

function sizing(style: Declarations, axis: 'width' | 'height'): OpenElement['layout'] {
	const sizingAxis: NonNullable<OpenElement['layout']> = {};
	// `flex: 1` grows the box into the free space (both axes), overriding
	// any percentage on the same axis.
	if (style.flex !== undefined) {
		return { [axis]: { type: 'grow' } };
	}
	const percent = fraction(style[axis]);
	if (percent !== undefined) {
		return { [axis]: { type: 'percent', value: percent } };
	}
	const px = cells(style[axis]);
	if (px !== undefined) {
		return { [axis]: { type: 'fixed', value: px } };
	}
	return sizingAxis;
}

/// Element ops for one box: open (styled) + children + close.
function boxOps({
	id,
	style,
	children,
}: {
	id: string;
	style: Declarations;
	children: Op[];
}): Op[] {
	const props: Omit<OpenElement, 'directive' | 'id'> = {};
	const layout: NonNullable<OpenElement['layout']> = {
		...sizing(style, 'width'),
		...sizing(style, 'height'),
	};
	const direction = style['flex-direction'];
	if (direction === 'row') {
		layout.direction = 'ltr';
	} else if (direction === 'column') {
		layout.direction = 'ttb';
	}
	const gap = cells(style.gap);
	if (gap !== undefined) {
		layout.gap = gap;
	}
	const padding = cells(style.padding);
	if (padding !== undefined) {
		layout.padding = { left: padding, right: padding, top: padding, bottom: padding };
	}
	props.layout = layout;

	const bg = colorOf(style['background-color']);
	if (bg !== undefined) {
		props.bg = bg;
	}
	const borderWidth = cells(style.border);
	const borderColor = colorOf(style['border-color']);
	if (borderWidth !== undefined && borderColor !== undefined) {
		props.border = {
			color: borderColor,
			left: borderWidth,
			right: borderWidth,
			top: borderWidth,
			bottom: borderWidth,
		};
	}
	return [open(id, props), ...children, close()];
}

/// Render the whole snapshot: one styled op stream per node, in document
/// order, styled by the index-aligned computed declarations.
export function renderTree(
	{ nodes, parents, texts }: { nodes: CssNode[]; parents: number[]; texts: (string | undefined)[] },
	computed: ComputedProperty[][],
): Op[] {
	const styles = computed.map(declarationsOf);
	const childIndices: number[][] = nodes.map(() => []);
	nodes.forEach((_, index) => {
		const parent = parents[index]!;
		if (parent !== NO_PARENT) {
			childIndices[parent]?.push(index);
		}
	});

	const build = (index: number): Op[] => {
		const node = nodes[index]!;
		const style = styles[index]!;
		const children = (childIndices[index] ?? []).flatMap(build);
		if (node.tag === 'text') {
			const color = colorOf(style.color);
			return [text(texts[index] ?? '', color !== undefined ? { color } : {})];
		}
		return boxOps({ id: node.id ?? `node-${index}`, style, children });
	};

	return nodes[0] ? build(0) : [];
}

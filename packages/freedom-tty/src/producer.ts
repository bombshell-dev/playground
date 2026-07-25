import { inspectFocus, type FocusBoundaryInspection, type Node } from '@bomb.sh/freedom';
import type { RenderInfo } from '@bomb.sh/tty';
import {
	encodeFreedomTtyFrame,
	type FloatRect,
	type FreedomTtyFrameV1,
	type FreedomTtyNodeV1,
	type JsonScalar,
	type Rect,
} from './protocol.ts';

export * from './protocol.ts';

export interface ProducerOptions {
	root: Node;
	info: RenderInfo;
	frame: number;
	renderSurface: { columns: number; rows: number; row?: number };
	/** Explicit opt-in for application-defined scalar semantics. */
	attributes?(node: Node): Readonly<Record<string, JsonScalar | unknown>> | undefined;
	/**
	 * Authoritative tty clipping result. Without this callback the producer
	 * deliberately omits visibleBounds rather than guessing from viewport-only
	 * geometry.
	 */
	visibleBounds?(node: Node, terminalBounds: Rect): Rect | undefined;
	onDiagnostic?(message: string): void;
}

function trunc(value: number): number {
	return value < 0 ? Math.ceil(value) : Math.floor(value);
}
function intersect(a: Rect, b: Rect): Rect | undefined {
	const left = Math.max(a.column, b.column),
		top = Math.max(a.row, b.row);
	const right = Math.min(a.column + a.width, b.column + b.width),
		bottom = Math.min(a.row + a.height, b.row + b.height);
	return right > left && bottom > top
		? { column: left, row: top, width: right - left, height: bottom - top }
		: undefined;
}

/** Clay-compatible edge truncation, deliberately not floor(origin)+ceil(size). */
export function geometryFor(
	layoutBounds: FloatRect,
	surface: { columns: number; rows: number; row?: number },
	clippedBounds?: Rect,
): { layoutBounds: FloatRect; terminalBounds: Rect; visibleBounds?: Rect } {
	const originRow = (surface.row ?? 1) - 1;
	const left = trunc(layoutBounds.x),
		right = trunc(layoutBounds.x + layoutBounds.width);
	const top = trunc(layoutBounds.y) + originRow,
		bottom = trunc(layoutBounds.y + layoutBounds.height) + originRow;
	const terminalBounds = {
		column: left,
		row: top,
		width: Math.max(0, right - left),
		height: Math.max(0, bottom - top),
	};
	const viewport = { column: 0, row: 0, width: surface.columns, height: surface.rows };
	const visibleBounds = clippedBounds
		? intersect(
				intersect(terminalBounds, clippedBounds) ?? { column: 0, row: 0, width: 0, height: 0 },
				viewport,
			)
		: undefined;
	return {
		layoutBounds: Object.freeze({ ...layoutBounds }),
		terminalBounds: Object.freeze(terminalBounds),
		...(visibleBounds ? { visibleBounds: Object.freeze(visibleBounds) } : {}),
	};
}

function safeString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}
function customAttributes(
	node: Node,
	options: ProducerOptions,
): Record<string, JsonScalar> | undefined {
	const requested = options.attributes?.(node);
	if (!requested) return undefined;
	const out: Record<string, JsonScalar> = {};
	for (const [key, value] of Object.entries(requested)) {
		if (Buffer.byteLength(key, 'utf8') > 256 || !/^[A-Za-z_][-A-Za-z0-9_]*$/.test(key)) {
			options.onDiagnostic?.(`Omitted invalid semantic attribute ${key.slice(0, 64)}`);
			continue;
		}
		if (
			value !== null &&
			typeof value !== 'string' &&
			typeof value !== 'number' &&
			typeof value !== 'boolean'
		) {
			options.onDiagnostic?.(`Omitted non-scalar semantic attribute ${key}`);
			continue;
		}
		if (typeof value === 'number' && !Number.isFinite(value)) {
			options.onDiagnostic?.(`Omitted non-finite semantic attribute ${key}`);
			continue;
		}
		if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > 1024) {
			options.onDiagnostic?.(`Omitted oversized semantic attribute ${key}`);
			continue;
		}
		out[key] = value;
	}
	return Object.keys(out).length ? out : undefined;
}

/** Builds a safe, complete snapshot. It never reads Freedom value/caret data. */
export function inspectFreedomTty(options: ProducerOptions): FreedomTtyFrameV1 {
	if (!Number.isSafeInteger(options.frame) || options.frame <= 0)
		throw new RangeError('frame must be a positive safe integer');
	const focus = inspectFocus(options.root),
		nodes: FreedomTtyNodeV1[] = [];
	const surface = {
		columns: options.renderSurface.columns,
		rows: options.renderSurface.rows,
		row: options.renderSurface.row ?? 1,
	};
	function visit(node: Node, parent: Node | undefined, order: number): void {
		const element = options.info.get(node.id);
		const bounds = element?.bounds;
		const custom = customAttributes(node, options);
		const layoutBounds =
			bounds &&
			Number.isFinite(bounds.x) &&
			Number.isFinite(bounds.y) &&
			Number.isFinite(bounds.width) &&
			Number.isFinite(bounds.height) &&
			bounds.width >= 0 &&
			bounds.height >= 0
				? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
				: undefined;
		nodes.push(
			Object.freeze({
				key: node.id,
				name: node.name,
				parent: parent?.id ?? null,
				order,
				attributes: Object.freeze({
					role: safeString(node.props.role),
					label: safeString(node.props.label),
					input: node.props.input === true ? true : undefined,
					focusable: 'focused' in node.props,
					...(custom ? { custom } : {}),
				}),
				states: Object.freeze({
					focused: focus.focused?.id === node.id,
					focusRoot: focus.activeRoot.id === node.id,
				}),
				...(layoutBounds
					? {
							geometry: geometryFor(
								layoutBounds,
								surface,
								options.visibleBounds?.(node, geometryFor(layoutBounds, surface).terminalBounds),
							),
						}
					: {}),
			}),
		);
		let childOrder = 0;
		for (const child of node.children) visit(child, node, childOrder++);
	}
	visit(options.root, undefined, 0);
	return Object.freeze({
		version: 1,
		frame: options.frame,
		renderSurface: Object.freeze(surface),
		focusStack: Object.freeze(focus.stack.map((entry: FocusBoundaryInspection) => entry.root.id)),
		nodes: Object.freeze(nodes),
	});
}

/** Emit only when explicitly enabled and always after the corresponding visual bytes. */
export function writeInspectedRender(
	write: (bytes: Uint8Array) => void,
	visual: Uint8Array,
	options: ProducerOptions,
): FreedomTtyFrameV1 | undefined {
	write(visual);
	if (typeof process === 'undefined' || process.env.GHOSTWRIGHT_FREEDOM_TTY !== '1')
		return undefined;
	const frame = inspectFreedomTty(options);
	write(encodeFreedomTtyFrame(frame));
	return frame;
}

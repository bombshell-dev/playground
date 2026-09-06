/**
 * Wire protocol for the clack.ui semantic tree: OSC `7777;clack.ui;v=1;<payload>ST`.
 *
 * One current schema, with bounded payloads, strict validation, and original
 * geometry. The envelope marker identifies the wire format, not a type family.
 *
 * Schema reference: .pi/specs/ghostwright-clack-tty-spec.md (REQ-006..REQ-009).
 */
// oxlint-disable bombshell-dev/exported-function-async -- OSC decoding and geometry calculations must remain synchronous.
import { GhostwrightError } from 'ghostwright';

export const CLACK_TTY_OSC = 7777;
export const CLACK_TTY_NAMESPACE = 'clack.ui';
export const CLACK_TTY_VERSION = 1;

/** Hard limits enforced before allocation on both producer and consumer sides (REQ-008). */
export const LIMITS = {
	payloadBytes: 512 * 1024,
	nodes: 4096,
	key: 256,
	name: 256,
	attribute: 1024,
	depth: 128,
} as const;

export interface FloatRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface Rect {
	readonly column: number;
	readonly row: number;
	readonly width: number;
	readonly height: number;
}

export type JsonScalar = string | number | boolean | null;

export interface ClackNodeAttrs {
	readonly role?: string;
	readonly label?: string;
	readonly input?: boolean;
	readonly custom?: Readonly<Record<string, JsonScalar>>;
}

export interface ClackNodeGeometry {
	readonly layout: FloatRect;
	readonly term: Rect;
	readonly visible?: Rect;
}

export interface ClackNode {
	readonly key: string;
	readonly name: string;
	readonly parent: string | null;
	readonly order: number;
	readonly attrs: ClackNodeAttrs;
	readonly geo?: ClackNodeGeometry;
}

export interface ClackFrame {
	readonly v: 1;
	readonly frame: number;
	readonly surface: Readonly<{ columns: number; rows: number; row: number }>;
	readonly nodes: readonly ClackNode[];
}

const utf8 = new TextEncoder();
function fail(code: string, message: string): never {
	throw new GhostwrightError({ code, message: message.slice(0, 1024) });
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);
const isScalar = (value: unknown): value is JsonScalar =>
	value === null ||
	typeof value === 'string' ||
	typeof value === 'boolean' ||
	(typeof value === 'number' && Number.isFinite(value));

/** Encode a semantic frame into its registered OSC byte sequence (REQ-005). */
export function encodeFrame(frame: ClackFrame): Uint8Array {
	const json = JSON.stringify(validateFrame(frame));
	const bytes = utf8.encode(json);
	if (bytes.length > LIMITS.payloadBytes)
		fail(
			'GW_CLACK_LIMIT',
			`Semantic frame payload is ${bytes.length} bytes, over the ${LIMITS.payloadBytes} byte limit`,
		);
	const payload = Buffer.from(json).toString('base64url');
	return Buffer.from(`\u001b]${CLACK_TTY_OSC};${CLACK_TTY_NAMESPACE};v=1;${payload}\u001b\\`);
}

/** Decode a registered OSC payload into a validated frame (REQ-016). */
export function decodeFrame(payload: Uint8Array): ClackFrame {
	if (payload.length > Math.ceil((LIMITS.payloadBytes * 4) / 3))
		fail('GW_CLACK_LIMIT', 'Encoded payload exceeds limit');
	const source = new TextDecoder('utf-8', { fatal: true }).decode(payload);
	if (!/^[A-Za-z0-9_-]*$/.test(source))
		fail('GW_CLACK_BASE64', 'Semantic payload is not unpadded base64url');
	let decoded: Buffer;
	try {
		decoded = Buffer.from(source, 'base64url');
		if (decoded.toString('base64url') !== source) fail('GW_CLACK_BASE64', 'Noncanonical base64url');
	} catch {
		fail('GW_CLACK_BASE64', 'Semantic payload cannot be decoded');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
	} catch {
		fail('GW_CLACK_BASE64', 'Semantic payload is not valid UTF-8 JSON');
	}
	return validateFrame(parsed);
}

/** Validate an already-parsed frame against the v1 schema and limits (REQ-006, REQ-008). */
export function validateFrame(input: unknown): ClackFrame {
	if (!isRecord(input)) fail('GW_CLACK_SCHEMA', 'Semantic frame must be an object');
	const frame = input;
	if (frame.v !== CLACK_TTY_VERSION)
		fail('GW_CLACK_VERSION', `Unsupported semantic frame version: ${String(frame.v)}`);
	if (typeof frame.frame !== 'number' || !Number.isSafeInteger(frame.frame) || frame.frame <= 0)
		fail('GW_CLACK_SCHEMA', 'Frame number must be a positive safe integer');
	const surface = frame.surface;
	if (
		!isRecord(surface) ||
		typeof surface.columns !== 'number' ||
		!Number.isInteger(surface.columns) ||
		typeof surface.rows !== 'number' ||
		!Number.isInteger(surface.rows) ||
		typeof surface.row !== 'number' ||
		!Number.isInteger(surface.row) ||
		surface.columns <= 0 ||
		surface.rows <= 0 ||
		surface.row <= 0
	)
		fail('GW_CLACK_SCHEMA', 'Invalid render surface');
	if (!Array.isArray(frame.nodes)) fail('GW_CLACK_SCHEMA', 'Invalid semantic node list');
	const rawNodes: unknown[] = frame.nodes;
	if (rawNodes.length > LIMITS.nodes)
		fail('GW_CLACK_LIMIT', `Semantic frame exceeds ${LIMITS.nodes} nodes`);
	const nodes = rawNodes.map((raw, index) => validateNode(raw, index));
	validateTree(nodes);
	return {
		v: 1,
		frame: frame.frame,
		surface: {
			columns: surface.columns,
			rows: surface.rows,
			row: surface.row,
		},
		nodes: Object.freeze(nodes),
	};
}

function validateNode(raw: unknown, index: number): ClackNode {
	if (!isRecord(raw)) fail('GW_CLACK_SCHEMA', `Node ${index} must be an object`);
	const node = raw;
	const key = stringField(node.key, `node ${index} key`, LIMITS.key);
	const name = stringField(node.name, `node ${index} name`, LIMITS.name);
	if (node.parent !== null && typeof node.parent !== 'string')
		fail('GW_CLACK_SCHEMA', `Node ${key} has an invalid parent`);
	if (typeof node.order !== 'number' || !Number.isInteger(node.order) || node.order < 0)
		fail('GW_CLACK_SCHEMA', `Node ${key} has an invalid sibling order`);
	const attrs = node.attrs;
	if (!isRecord(attrs)) fail('GW_CLACK_SCHEMA', `Node ${key} has invalid attributes`);
	const role =
		attrs.role === undefined
			? undefined
			: stringField(attrs.role, `node ${key} role`, LIMITS.attribute);
	const label =
		attrs.label === undefined
			? undefined
			: stringField(attrs.label, `node ${key} label`, LIMITS.attribute);
	if (attrs.input !== undefined && typeof attrs.input !== 'boolean')
		fail('GW_CLACK_SCHEMA', `Node ${key} has an invalid input attribute`);
	let custom: Record<string, JsonScalar> | undefined;
	if (attrs.custom !== undefined) {
		if (!isRecord(attrs.custom))
			fail('GW_CLACK_SCHEMA', `Node ${key} has invalid custom attributes`);
		custom = Object.fromEntries(
			Object.entries(attrs.custom).map(([attribute, value]) => {
				if (attribute.length === 0 || utf8.encode(attribute).length > LIMITS.key)
					fail('GW_CLACK_SCHEMA', `Node ${key} has an invalid custom attribute name`);
				if (!isScalar(value))
					fail('GW_CLACK_SCHEMA', `Node ${key} custom attribute ${attribute} is not a scalar`);
				if (typeof value === 'string' && utf8.encode(value).length > LIMITS.attribute)
					fail(
						'GW_CLACK_SCHEMA',
						`Node ${key} custom attribute ${attribute} exceeds the value limit`,
					);
				return [attribute, value];
			}),
		);
	}
	return {
		key,
		name,
		parent: node.parent,
		order: node.order,
		attrs: {
			...(role !== undefined ? { role } : {}),
			...(label !== undefined ? { label } : {}),
			...(attrs.input !== undefined ? { input: attrs.input } : {}),
			...(custom !== undefined ? { custom } : {}),
		},
		...(node.geo !== undefined ? { geo: validateGeometry(node.geo, key) } : {}),
	};
}

function validateGeometry(raw: unknown, key: string): ClackNodeGeometry {
	if (!isRecord(raw)) fail('GW_CLACK_SCHEMA', `Node ${key} has invalid geometry`);
	const geo = raw;
	const layout = floatRect(geo.layout, key, 'layout');
	const term = cellRect(geo.term, key, 'term');
	const visible = geo.visible === undefined ? undefined : cellRect(geo.visible, key, 'visible');
	return { layout, term, ...(visible !== undefined ? { visible } : {}) };
}

// oxlint-disable-next-line bombshell-dev/max-params -- value, diagnostic identity, and shared budget
function floatRect(raw: unknown, key: string, field: string): FloatRect {
	if (!isRecord(raw)) fail('GW_CLACK_SCHEMA', `Node ${key} has invalid ${field} geometry`);
	const context = `Node ${key} has invalid ${field}`;
	const rect = {
		x: numberField(raw.x, `${context} x`),
		y: numberField(raw.y, `${context} y`),
		width: numberField(raw.width, `${context} width`),
		height: numberField(raw.height, `${context} height`),
	};
	if (rect.width < 0 || rect.height < 0)
		fail('GW_CLACK_SCHEMA', `Node ${key} has a negative ${field} size`);
	return rect;
}

// oxlint-disable-next-line bombshell-dev/max-params -- value, diagnostic identity, and shared budget
function cellRect(raw: unknown, key: string, field: string): Rect {
	if (!isRecord(raw)) fail('GW_CLACK_SCHEMA', `Node ${key} has invalid ${field} geometry`);
	const context = `Node ${key} has invalid ${field}`;
	const rect = {
		column: integerField(raw.column, `${context} column`),
		row: integerField(raw.row, `${context} row`),
		width: integerField(raw.width, `${context} width`),
		height: integerField(raw.height, `${context} height`),
	};
	if (rect.width < 0 || rect.height < 0)
		fail('GW_CLACK_SCHEMA', `Node ${key} has a negative ${field} size`);
	return rect;
}

function numberField(value: unknown, message: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) fail('GW_CLACK_SCHEMA', message);
	return value;
}

function integerField(value: unknown, message: string): number {
	const number = numberField(value, message);
	if (!Number.isInteger(number)) fail('GW_CLACK_SCHEMA', message);
	return number;
}

// oxlint-disable-next-line bombshell-dev/max-params -- value, diagnostic identity, and shared budget
function stringField(value: unknown, what: string, limit: number): string {
	if (typeof value !== 'string' || value.length === 0)
		fail('GW_CLACK_SCHEMA', `${what} must be a non-empty string`);
	if (utf8.encode(value).length > limit) fail('GW_CLACK_LIMIT', `${what} exceeds ${limit} bytes`);
	return value;
}

/** Reject duplicate keys and parent links that do not form an acyclic tree within the depth limit (REQ-008). */
function validateTree(nodes: readonly ClackNode[]): void {
	const byKey = new Map<string, ClackNode>();
	for (const node of nodes) {
		if (byKey.has(node.key)) fail('GW_CLACK_SCHEMA', `Duplicate semantic node key ${node.key}`);
		byKey.set(node.key, node);
	}
	for (const node of nodes) {
		if (node.parent !== null && !byKey.has(node.parent))
			fail('GW_CLACK_SCHEMA', `Missing parent ${node.parent}`);
		let current = node.parent ? byKey.get(node.parent) : undefined;
		const seen = new Set([node.key]);
		let depth = 0;
		while (current) {
			if (++depth > LIMITS.depth)
				fail('GW_CLACK_LIMIT', `Tree exceeds the depth limit of ${LIMITS.depth}`);
			if (seen.has(current.key))
				fail('GW_CLACK_SCHEMA', `Node ${node.key} participates in a parent cycle`);
			seen.add(current.key);
			current = current.parent ? byKey.get(current.parent) : undefined;
		}
	}
}

/**
 * Truncate both float edges to match the renderer's cell bounds.
 * Truncating the origin and rounding the size can produce different bounds.
 * `surface.row` is 1-based; the result is in zero-based terminal cell space.
 */
export function geometryFor(
	layoutBounds: FloatRect,
	surface: { columns: number; rows: number; row?: number },
): { layout: FloatRect; term: Rect; visible?: Rect } {
	const trunc = Math.trunc;
	const originRow = (surface.row ?? 1) - 1;
	const left = trunc(layoutBounds.x),
		right = trunc(layoutBounds.x + layoutBounds.width);
	const top = trunc(layoutBounds.y) + originRow,
		bottom = trunc(layoutBounds.y + layoutBounds.height) + originRow;
	const term: Rect = {
		column: left,
		row: top,
		width: Math.max(0, right - left),
		height: Math.max(0, bottom - top),
	};
	const viewport: Rect = { column: 0, row: 0, width: surface.columns, height: surface.rows };
	const visible = intersect(term, viewport);
	return {
		layout: { ...layoutBounds },
		term,
		...(visible !== undefined ? { visible } : {}),
	};
}

/** Return the shared cell bounds, or undefined when rectangles do not overlap. */
export function intersect(a: Rect, b: Rect): Rect | undefined {
	const left = Math.max(a.column, b.column),
		top = Math.max(a.row, b.row);
	const right = Math.min(a.column + a.width, b.column + b.width),
		bottom = Math.min(a.row + a.height, b.row + b.height);
	return right > left && bottom > top
		? { column: left, row: top, width: right - left, height: bottom - top }
		: undefined;
}

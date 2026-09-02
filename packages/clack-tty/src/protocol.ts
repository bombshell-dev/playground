/**
 * Wire protocol for the clack.ui semantic tree: OSC `7777;clack.ui;v=1;<payload>ST`.
 *
 * Version 1 is independent of the retired FreedomTtyFrameV1. It keeps the spike's
 * lessons: versioned envelopes, bounded payloads, strict fail-closed validation,
 * and honest geometry (authoritative bounds only, never guessed).
 *
 * Schema reference: .pi/specs/ghostwright-clack-tty-spec.md (REQ-006..REQ-009).
 */
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
	readonly focusable: boolean;
	readonly custom?: Readonly<Record<string, JsonScalar>>;
}

export interface ClackNodeStates {
	readonly focused: boolean;
	readonly focusRoot: boolean;
}

export interface ClackNodeGeometry {
	readonly layout: FloatRect;
	readonly term: Rect;
	readonly visible?: Rect;
}

export interface ClackNodeV1 {
	readonly key: string;
	readonly name: string;
	readonly parent: string | null;
	readonly order: number;
	readonly attrs: ClackNodeAttrs;
	readonly states: ClackNodeStates;
	readonly geo?: ClackNodeGeometry;
}

export interface ClackFrameV1 {
	readonly v: 1;
	readonly frame: number;
	readonly surface: Readonly<{ columns: number; rows: number; row: number }>;
	readonly focusStack: readonly string[];
	readonly nodes: readonly ClackNodeV1[];
}

const utf8 = new TextEncoder();
const fail = (code: string, message: string): never => {
	throw new GhostwrightError({ code, message: message.slice(0, 1024) });
};
const isScalar = (value: unknown): value is JsonScalar =>
	value === null ||
	typeof value === 'string' ||
	typeof value === 'boolean' ||
	(typeof value === 'number' && Number.isFinite(value));

/** Encode a semantic frame into its registered OSC byte sequence (REQ-005). */
export function encodeFrame(frame: ClackFrameV1): Uint8Array {
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
export function decodeFrame(payload: Uint8Array): ClackFrameV1 {
	const source = Buffer.from(payload).toString('ascii');
	if (!/^[A-Za-z0-9_-]*$/.test(source))
		fail('GW_CLACK_BASE64', 'Semantic payload is not unpadded base64url');
	let decoded: Buffer;
	try {
		decoded = Buffer.from(source, 'base64url');
	} catch {
		fail('GW_CLACK_BASE64', 'Semantic payload cannot be decoded');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(decoded.toString('utf8'));
	} catch {
		fail('GW_CLACK_BASE64', 'Semantic payload is not valid UTF-8 JSON');
	}
	return validateFrame(parsed);
}

/** Validate an already-parsed frame against the v1 schema and limits (REQ-006, REQ-008). */
export function validateFrame(input: unknown): ClackFrameV1 {
	if (!input || typeof input !== 'object' || Array.isArray(input))
		fail('GW_CLACK_SCHEMA', 'Semantic frame must be an object');
	const frame = input as Record<string, unknown>;
	if (frame.v !== CLACK_TTY_VERSION)
		fail('GW_CLACK_VERSION', `Unsupported semantic frame version: ${String(frame.v)}`);
	if (!Number.isSafeInteger(frame.frame) || (frame.frame as number) <= 0)
		fail('GW_CLACK_SCHEMA', 'Frame number must be a positive safe integer');
	const surface = frame.surface as Record<string, unknown> | undefined;
	if (
		!surface ||
		!Number.isInteger(surface.columns) ||
		!Number.isInteger(surface.rows) ||
		!Number.isInteger(surface.row) ||
		(surface.columns as number) <= 0 ||
		(surface.rows as number) <= 0 ||
		(surface.row as number) <= 0
	)
		fail('GW_CLACK_SCHEMA', 'Invalid render surface');
	const focusStack = frame.focusStack;
	if (!Array.isArray(focusStack) || !focusStack.every((key) => typeof key === 'string'))
		fail('GW_CLACK_SCHEMA', 'Invalid focus stack');
	if (!Array.isArray(frame.nodes)) fail('GW_CLACK_SCHEMA', 'Invalid semantic node list');
	const rawNodes = frame.nodes as unknown[];
	if (rawNodes.length > LIMITS.nodes)
		fail('GW_CLACK_LIMIT', `Semantic frame exceeds ${LIMITS.nodes} nodes`);
	const nodes = rawNodes.map((raw, index) => validateNode(raw, index));
	validateTree(nodes);
	return {
		v: 1,
		frame: frame.frame as number,
		surface: {
			columns: surface.columns as number,
			rows: surface.rows as number,
			row: surface.row as number,
		},
		focusStack: Object.freeze([...(focusStack as string[])]),
		nodes: Object.freeze(nodes),
	};
}

function validateNode(raw: unknown, index: number): ClackNodeV1 {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw))
		fail('GW_CLACK_SCHEMA', `Node ${index} must be an object`);
	const node = raw as Record<string, unknown>;
	const key = stringField(node.key, `node ${index} key`, LIMITS.key);
	const name = stringField(node.name, `node ${index} name`, LIMITS.name);
	if (node.parent !== null && typeof node.parent !== 'string')
		fail('GW_CLACK_SCHEMA', `Node ${key} has an invalid parent`);
	if (!Number.isInteger(node.order) || (node.order as number) < 0)
		fail('GW_CLACK_SCHEMA', `Node ${key} has an invalid sibling order`);
	const attrs = node.attrs as Record<string, unknown> | undefined;
	if (!attrs || typeof attrs.focusable !== 'boolean')
		fail('GW_CLACK_SCHEMA', `Node ${key} has invalid attributes`);
	if (attrs.role !== undefined) stringField(attrs.role, `node ${key} role`, LIMITS.attribute);
	if (attrs.label !== undefined) stringField(attrs.label, `node ${key} label`, LIMITS.attribute);
	if (attrs.input !== undefined && typeof attrs.input !== 'boolean')
		fail('GW_CLACK_SCHEMA', `Node ${key} has an invalid input attribute`);
	let custom: Record<string, JsonScalar> | undefined;
	if (attrs.custom !== undefined) {
		if (!attrs.custom || typeof attrs.custom !== 'object' || Array.isArray(attrs.custom))
			fail('GW_CLACK_SCHEMA', `Node ${key} has invalid custom attributes`);
		custom = {};
		for (const [name, value] of Object.entries(attrs.custom as Record<string, unknown>)) {
			if (typeof name !== 'string' || name.length === 0 || utf8.encode(name).length > LIMITS.key)
				fail('GW_CLACK_SCHEMA', `Node ${key} has an invalid custom attribute name`);
			if (!isScalar(value))
				fail('GW_CLACK_SCHEMA', `Node ${key} custom attribute ${name} is not a scalar`);
			if (typeof value === 'string' && utf8.encode(value).length > LIMITS.attribute)
				fail('GW_CLACK_SCHEMA', `Node ${key} custom attribute ${name} exceeds the value limit`);
			custom[name] = value as JsonScalar;
		}
	}
	const states = node.states as Record<string, unknown> | undefined;
	if (
		!states ||
		typeof states.focused !== 'boolean' ||
		typeof states.focusRoot !== 'boolean'
	)
		fail('GW_CLACK_SCHEMA', `Node ${key} has invalid states`);
	return {
		key,
		name,
		parent: node.parent === null ? null : (node.parent as string),
		order: node.order as number,
		attrs: {
			...(attrs.role !== undefined ? { role: attrs.role as string } : {}),
			...(attrs.label !== undefined ? { label: attrs.label as string } : {}),
			...(attrs.input !== undefined ? { input: attrs.input as boolean } : {}),
			focusable: attrs.focusable as boolean,
			...(custom !== undefined ? { custom } : {}),
		},
		states: { focused: states.focused as boolean, focusRoot: states.focusRoot as boolean },
		...(node.geo !== undefined ? { geo: validateGeometry(node.geo, key) } : {}),
	};
}

function validateGeometry(raw: unknown, key: string): ClackNodeGeometry {
	if (!raw || typeof raw !== 'object')
		fail('GW_CLACK_SCHEMA', `Node ${key} has invalid geometry`);
	const geo = raw as Record<string, unknown>;
	const layout = floatRect(geo.layout, key, 'layout');
	const term = cellRect(geo.term, key, 'term');
	const visible =
		geo.visible === undefined ? undefined : cellRect(geo.visible, key, 'visible');
	return { layout, term, ...(visible !== undefined ? { visible } : {}) };
}

function floatRect(raw: unknown, key: string, field: string): FloatRect {
	if (!raw || typeof raw !== 'object')
		fail('GW_CLACK_SCHEMA', `Node ${key} has invalid ${field} geometry`);
	const rect = raw as Record<string, unknown>;
	for (const edge of ['x', 'y', 'width', 'height'])
		if (typeof rect[edge] !== 'number' || !Number.isFinite(rect[edge]))
			fail('GW_CLACK_SCHEMA', `Node ${key} has invalid ${field} ${edge}`);
	if ((rect.width as number) < 0 || (rect.height as number) < 0)
		fail('GW_CLACK_SCHEMA', `Node ${key} has a negative ${field} size`);
	return {
		x: rect.x as number,
		y: rect.y as number,
		width: rect.width as number,
		height: rect.height as number,
	};
}

function cellRect(raw: unknown, key: string, field: string): Rect {
	if (!raw || typeof raw !== 'object')
		fail('GW_CLACK_SCHEMA', `Node ${key} has invalid ${field} geometry`);
	const rect = raw as Record<string, unknown>;
	for (const edge of ['column', 'row', 'width', 'height'])
		if (!Number.isInteger(rect[edge]))
			fail('GW_CLACK_SCHEMA', `Node ${key} has invalid ${field} ${edge}`);
	if ((rect.width as number) < 0 || (rect.height as number) < 0)
		fail('GW_CLACK_SCHEMA', `Node ${key} has a negative ${field} size`);
	return {
		column: rect.column as number,
		row: rect.row as number,
		width: rect.width as number,
		height: rect.height as number,
	};
}

function stringField(value: unknown, what: string, limit: number): string {
	if (typeof value !== 'string' || value.length === 0)
		fail('GW_CLACK_SCHEMA', `${what} must be a non-empty string`);
	if (utf8.encode(value).length > limit)
		fail('GW_CLACK_LIMIT', `${what} exceeds ${limit} bytes`);
	return value;
}

/** Reject duplicate keys and parent links that do not form an acyclic tree within the depth limit (REQ-008). */
function validateTree(nodes: readonly ClackNodeV1[]): void {
	const byKey = new Map<string, ClackNodeV1>();
	for (const node of nodes) {
		if (byKey.has(node.key))
			fail('GW_CLACK_SCHEMA', `Duplicate semantic node key ${node.key}`);
		byKey.set(node.key, node);
	}
	for (const node of nodes) {
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
 * Clay-compatible edge truncation from authoritative float bounds, deliberately
 * not `floor(origin) + ceil(size)` (carried from the retired freedom producer).
 * `surface.row` is 1-based; the result is in 1-based terminal cell space.
 */
export function geometryFor(
	layoutBounds: FloatRect,
	surface: { columns: number; rows: number; row?: number },
): { layout: FloatRect; term: Rect; visible?: Rect } {
	const trunc = (value: number) => (value < 0 ? Math.ceil(value) : Math.floor(value));
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

export function intersect(a: Rect, b: Rect): Rect | undefined {
	const left = Math.max(a.column, b.column),
		top = Math.max(a.row, b.row);
	const right = Math.min(a.column + a.width, b.column + b.width),
		bottom = Math.min(a.row + a.height, b.row + b.height);
	return right > left && bottom > top
		? { column: left, row: top, width: right - left, height: bottom - top }
		: undefined;
}

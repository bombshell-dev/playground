import { ProtocolError } from '../errors.ts';

export const PROTOCOL_VERSION = 1;
export const HEADER_SIZE = 20;
export const MAGIC = new Uint8Array([0x47, 0x57, 0x50, 0x54]);
export const enum FrameKind {
	HELLO = 0x0001,
	SPAWN = 0x0002,
	WRITE = 0x0003,
	RESIZE = 0x0004,
	SIGNAL = 0x0005,
	CLOSE = 0x0006,
	READY = 0x8001,
	SPAWNED = 0x8002,
	ACK = 0x8003,
	ERROR = 0x80ff,
	OUTPUT = 0x8100,
	PROCESS_EXIT = 0x8101,
	PTY_EOF = 0x8102,
}
export interface Frame {
	kind: FrameKind;
	sequence: number;
	correlation: number;
	payload: Uint8Array;
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
	const n = parts.reduce((s, p) => s + p.length, 0),
		out = new Uint8Array(n);
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
};
function head(major: number, n: number): Uint8Array {
	if (!Number.isSafeInteger(n) || n < 0) throw new ProtocolError(`Invalid CBOR length ${n}`);
	if (n < 24) return Uint8Array.of((major << 5) | n);
	if (n <= 0xff) return Uint8Array.of((major << 5) | 24, n);
	if (n <= 0xffff) return Uint8Array.of((major << 5) | 25, n >> 8, n);
	const b = new Uint8Array(5);
	b[0] = (major << 5) | 26;
	new DataView(b.buffer).setUint32(1, n);
	return b;
}
/** Encode a JavaScript value to CBOR binary format. */
export function encodeCbor(value: unknown): Uint8Array {
	if (value === null) return Uint8Array.of(0xf6);
	if (value === false) return Uint8Array.of(0xf4);
	if (value === true) return Uint8Array.of(0xf5);
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) throw new ProtocolError('CBOR supports only safe integers');
		return value >= 0 ? head(0, value) : head(1, -1 - value);
	}
	if (typeof value === 'string') {
		const b = new TextEncoder().encode(value);
		return concat([head(3, b.length), b]);
	}
	if (value instanceof Uint8Array) return concat([head(2, value.length), value]);
	if (Array.isArray(value)) return concat([head(4, value.length), ...value.map(encodeCbor)]);
	if (typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.map(([k, v]) => [encodeCbor(k), encodeCbor(v)] as const)
			.toSorted((a, b) => a[0].length - b[0].length || compare(a[0], b[0]));
		return concat([head(5, entries.length), ...entries.flat()]);
	}
	throw new ProtocolError(`Unsupported CBOR value: ${typeof value}`);
}
function compare(a: Uint8Array, b: Uint8Array): number {
	for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
	return a.length - b.length;
}
const bad = (): ProtocolError => new ProtocolError('Truncated CBOR payload');
/** Decode a CBOR binary payload to a JavaScript value. */
export function decodeCbor(bytes: Uint8Array): unknown {
	let p = 0;
	const readLen = (ai: number) => {
		if (ai < 24) return ai;
		if (ai === 24) {
			if (p + 1 > bytes.length) throw bad();
			const n = bytes[p++];
			if (n < 24) throw new ProtocolError('Non-deterministic CBOR integer/length encoding');
			return n;
		}
		if (ai === 25) {
			if (p + 2 > bytes.length) throw bad();
			const n = (bytes[p] << 8) | bytes[p + 1];
			p += 2;
			if (n <= 0xff) throw new ProtocolError('Non-deterministic CBOR integer/length encoding');
			return n;
		}
		if (ai === 26) {
			if (p + 4 > bytes.length) throw bad();
			const n = new DataView(bytes.buffer, bytes.byteOffset + p, 4).getUint32(0);
			p += 4;
			if (n <= 0xffff) throw new ProtocolError('Non-deterministic CBOR integer/length encoding');
			return n;
		}
		throw new ProtocolError('Unsupported or indefinite CBOR length');
	};
	const one = (depth = 0): unknown => {
		if (depth > 64) throw new ProtocolError('CBOR nesting limit exceeded');
		if (p >= bytes.length) throw bad();
		const h = bytes[p++],
			m = h >> 5,
			ai = h & 31;
		if (m === 7) {
			if (ai === 20) return false;
			if (ai === 21) return true;
			if (ai === 22) return null;
			throw new ProtocolError('Unsupported CBOR simple value');
		}
		const n = readLen(ai);
		if (m === 0) return n;
		if (m === 1) return -1 - n;
		if (m === 2) {
			if (p + n > bytes.length) throw bad();
			return bytes.slice(p, (p += n));
		}
		if (m === 3) {
			if (p + n > bytes.length) throw bad();
			const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(p, p + n));
			p += n;
			return s;
		}
		if (m === 4) {
			const a = [];
			for (let i = 0; i < n; i++) a.push(one(depth + 1));
			return a;
		}
		if (m === 5) {
			const o: Record<string, unknown> = {};
			let previousKey: Uint8Array | undefined;
			for (let i = 0; i < n; i++) {
				const keyStart = p,
					k = one(depth + 1),
					keyBytes = bytes.slice(keyStart, p);
				if (typeof k !== 'string' || Object.hasOwn(o, k))
					throw new ProtocolError('Invalid or duplicate CBOR map key');
				if (
					previousKey &&
					(previousKey.length > keyBytes.length ||
						(previousKey.length === keyBytes.length && compare(previousKey, keyBytes) >= 0))
				)
					throw new ProtocolError('Non-deterministic CBOR map key ordering');
				previousKey = keyBytes;
				o[k] = one(depth + 1);
			}
			return o;
		}
		throw new ProtocolError('Unsupported CBOR major type');
	};
	const result = one();
	if (p !== bytes.length) throw new ProtocolError('Trailing CBOR bytes');
	return result;
}
/** Encode a frame to the GWPT wire format. */
export function encodeFrame(frame: Frame): Uint8Array {
	const raw = frame.kind === FrameKind.WRITE || frame.kind === FrameKind.OUTPUT;
	const max = raw ? 65536 : 1024 * 1024;
	if (frame.payload.length > max) throw new ProtocolError(`Frame payload exceeds ${max} bytes`);
	if (frame.sequence <= 0 || frame.sequence > 0xffffffff)
		throw new ProtocolError('Frame sequence must be a nonzero uint32');
	const out = new Uint8Array(HEADER_SIZE + frame.payload.length);
	out.set(MAGIC);
	const d = new DataView(out.buffer);
	d.setUint16(4, PROTOCOL_VERSION, true);
	d.setUint16(6, frame.kind, true);
	d.setUint32(8, frame.sequence, true);
	d.setUint32(12, frame.correlation, true);
	d.setUint32(16, frame.payload.length, true);
	out.set(frame.payload, HEADER_SIZE);
	return out;
}
export class FrameDecoder {
	#buffer = new Uint8Array();
	#last = 0;
	push(chunk: Uint8Array): Frame[] {
		this.#buffer = concat([this.#buffer, chunk]);
		const frames: Frame[] = [];
		while (this.#buffer.length >= HEADER_SIZE) {
			if (!MAGIC.every((v, i) => this.#buffer[i] === v))
				throw new ProtocolError('Invalid GWPT frame magic');
			const d = new DataView(this.#buffer.buffer, this.#buffer.byteOffset);
			const version = d.getUint16(4, true),
				kind = d.getUint16(6, true) as FrameKind,
				sequence = d.getUint32(8, true),
				correlation = d.getUint32(12, true),
				length = d.getUint32(16, true);
			if (version !== PROTOCOL_VERSION)
				throw new ProtocolError(`Unsupported protocol version ${version}`);
			const raw = kind === FrameKind.WRITE || kind === FrameKind.OUTPUT,
				max = raw ? 65536 : 1024 * 1024;
			if (length > max) throw new ProtocolError(`Frame payload exceeds ${max} bytes`);
			if (this.#buffer.length < HEADER_SIZE + length) break;
			if (sequence <= this.#last)
				throw new ProtocolError(`Duplicate or regressing frame sequence ${sequence}`);
			this.#last = sequence;
			frames.push({
				kind,
				sequence,
				correlation,
				payload: this.#buffer.slice(HEADER_SIZE, HEADER_SIZE + length),
			});
			this.#buffer = this.#buffer.slice(HEADER_SIZE + length);
		}
		return frames;
	}
}

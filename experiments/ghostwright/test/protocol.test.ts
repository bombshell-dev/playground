import { describe, expect, test } from 'bun:test';
import { decodeCbor, encodeCbor, encodeFrame, FrameDecoder, FrameKind } from '../src/pty/protocol';
describe('GWPT protocol', () => {
	test('deterministic CBOR round trip', () => {
		const value = {
			viewport: { columns: 80, rows: 24 },
			args: ['a', 'b'],
			enabled: true,
			none: null,
		};
		expect(decodeCbor(encodeCbor(value))).toEqual(value);
		expect(encodeCbor({ b: 1, a: 2 })).toEqual(encodeCbor({ a: 2, b: 1 }));
	});
	test('reassembles every fragmentation', () => {
		const bytes = encodeFrame({
			kind: FrameKind.OUTPUT,
			sequence: 1,
			correlation: 0,
			payload: Uint8Array.of(0, 255, 27),
		});
		for (let split = 0; split <= bytes.length; split++) {
			const d = new FrameDecoder();
			expect([...d.push(bytes.slice(0, split)), ...d.push(bytes.slice(split))]).toEqual([
				{ kind: FrameKind.OUTPUT, sequence: 1, correlation: 0, payload: Uint8Array.of(0, 255, 27) },
			]);
		}
	});
	test('rejects regressing sequences', () => {
		const d = new FrameDecoder(),
			f = encodeFrame({
				kind: FrameKind.PTY_EOF,
				sequence: 1,
				correlation: 0,
				payload: new Uint8Array(),
			});
		d.push(f);
		expect(() => d.push(f)).toThrow('regressing');
	});
	test('rejects non-deterministic and malformed CBOR', () => {
		expect(() => decodeCbor(Uint8Array.of(0x18, 0x01))).toThrow('Non-deterministic');
		// Map keys have equal encoded length but are in descending byte order.
		expect(() => decodeCbor(Uint8Array.of(0xa2, 0x61, 0x62, 0x01, 0x61, 0x61, 0x02))).toThrow(
			'ordering',
		);
		expect(() => decodeCbor(Uint8Array.of(0x63, 0xff, 0xff, 0xff))).toThrow();
	});
});

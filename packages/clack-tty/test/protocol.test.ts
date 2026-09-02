import { describe, expect, test } from 'vitest';
import {
	decodeFrame,
	encodeFrame,
	geometryFor,
	LIMITS,
	type ClackFrameV1,
	type ClackNodeV1,
} from '../src/protocol.ts';
import { clackTtyExtension, ClackTtySession } from '../src/extension.ts';
import type {
	ExtensionSessionContext,
	ExtensionRevision,
	GhostwrightError,
} from 'ghostwright';

function node(overrides: Partial<ClackNodeV1> = {}): ClackNodeV1 {
	return {
		key: '1',
		name: 'box',
		parent: null,
		order: 0,
		attrs: { focusable: false },
		states: { focused: false, focusRoot: false },
		...overrides,
	};
}

function frame(overrides: Partial<ClackFrameV1> = {}, nodes: ClackNodeV1[] = [node()]): ClackFrameV1 {
	return {
		v: 1,
		frame: 1,
		surface: { columns: 80, rows: 24, row: 1 },
		focusStack: [],
		nodes,
		...overrides,
	};
}

/** Minimal recording extension context: the real accept path, recorded revisions. */
function recordingContext() {
	const revisions: ExtensionRevision<ClackFrameV1>[] = [];
	const diagnostics: GhostwrightError[] = [];
	let sequence = 0;
	const context: ExtensionSessionContext<ClackFrameV1> = {
		terminal: {} as ExtensionSessionContext<ClackFrameV1>['terminal'],
		screen: {} as ExtensionSessionContext<ClackFrameV1>['screen'],
		publish(commit) {
			const revision: ExtensionRevision<ClackFrameV1> = {
				sequence: ++sequence,
				timestamp: 0,
				extensionId: 'test',
				protocolFrame: commit.protocolFrame,
				screenSequence: 0,
				value: commit.value,
			};
			revisions.push(revision);
			return revision;
		},
		diagnostic(error) {
			diagnostics.push(error);
		},
	};
	return { context, revisions, diagnostics };
}

/** Extract the payload section from an encoded envelope, as the OSC stream would. */
function payloadOf(bytes: Uint8Array): Uint8Array {
	const raw = Buffer.from(bytes).toString('latin1');
	const start = raw.indexOf(';v=1;') + 5;
	return Buffer.from(raw.slice(start, raw.length - 2), 'latin1');
}

describe('protocol codec (TC-U1)', () => {
	test('encode/decode round-trips a full tree deterministically', () => {
		const tree = frame(
			{ frame: 7, focusStack: ['3'] },
			[
				node({
					key: '1',
					name: 'box',
					attrs: { role: 'group', label: 'hello', focusable: false, custom: { 'x': 1 } },
					geo: {
						layout: { x: 0, y: 0, width: 40.5, height: 8 },
						term: { column: 0, row: 0, width: 40, height: 8 },
						visible: { column: 0, row: 0, width: 40, height: 8 },
					},
				}),
				node({ key: '2', name: 'text', parent: '1', order: 0 }),
				node({
					key: '3',
					name: 'input',
					parent: '1',
					order: 1,
					attrs: { role: 'textbox', label: 'say', input: true, focusable: true },
					states: { focused: true, focusRoot: true },
				}),
			],
		);
		const bytes = encodeFrame(tree);
		expect(decodeFrame(payloadOf(bytes))).toStrictEqual(tree);
		expect(encodeFrame(decodeFrame(payloadOf(bytes)))).toStrictEqual(bytes);
	});

	test('envelope is the registered OSC 7777;clack.ui;v=1 with ST terminator', () => {
		const bytes = Buffer.from(encodeFrame(frame()));
		expect(bytes.subarray(0, 20).toString('latin1')).toBe('\u001b]7777;clack.ui;v=1;');
		expect(bytes.subarray(bytes.length - 2).toString('latin1')).toBe('\u001b\\');
	});
});

describe('fail-closed validation (TC-U2)', () => {
	const cases: { name: string; code: string; frame: () => unknown }[] = [
		{ name: 'bad base64 charset', code: 'GW_CLACK_BASE64', frame: () => decodeFrame(Buffer.from('!!not-base64!!')) },
		{ name: 'invalid JSON', code: 'GW_CLACK_BASE64', frame: () => decodeFrame(Buffer.from('{not json')) },
		{
			name: 'version mismatch',
			code: 'GW_CLACK_VERSION',
			frame: () => frame({ v: 2 as unknown as 1 }),
		},
		{ name: 'frame not object', code: 'GW_CLACK_SCHEMA', frame: () => 'nope' as unknown as ClackFrameV1 },
		{ name: 'zero frame number', code: 'GW_CLACK_SCHEMA', frame: () => frame({ frame: 0 }) },
		{ name: 'bad surface', code: 'GW_CLACK_SCHEMA', frame: () => frame({ surface: { columns: 0, rows: 24, row: 1 } }) },
		{ name: 'focus stack not strings', code: 'GW_CLACK_SCHEMA', frame: () => frame({ focusStack: [1] }) },
		{ name: 'duplicate node key', code: 'GW_CLACK_SCHEMA', frame: () => frame({}, [node(), node()]) },
		{ name: 'parent cycle', code: 'GW_CLACK_SCHEMA', frame: () => frame({}, [
			node({ key: 'a', parent: 'b' }),
			node({ key: 'b', parent: 'a' }),
		]) },
		{ name: 'depth over limit', code: 'GW_CLACK_LIMIT', frame: () => {
			const chain: ClackNodeV1[] = [node({ key: 'n0' })];
			for (let i = 1; i <= LIMITS.depth + 1; i++)
				chain.push(node({ key: `n${i}`, parent: `n${i - 1}`, order: 0 }));
			return frame({}, chain);
		} },
		{
			name: 'too many nodes',
			code: 'GW_CLACK_LIMIT',
			frame: () => frame({}, Array.from({ length: LIMITS.nodes + 1 }, (_, i) => node({ key: `k${i}` }))),
		},
		{
			name: 'non-scalar custom attribute',
			code: 'GW_CLACK_SCHEMA',
			frame: () => frame({}, [node({ attrs: { focusable: false, custom: { x: { deep: true } } } })]),
		},
		{
			name: 'missing focusable attribute',
			code: 'GW_CLACK_SCHEMA',
			frame: () => frame({}, [node({ attrs: {} as ClackNodeV1['attrs'] })]),
		},
		{
			name: 'missing states',
			code: 'GW_CLACK_SCHEMA',
			frame: () => frame({}, [node({ states: undefined as unknown as ClackNodeV1['states'] })]),
		},
		{
			name: 'negative geometry size',
			code: 'GW_CLACK_SCHEMA',
			frame: () => frame({}, [node({
				geo: { layout: { x: 0, y: 0, width: -1, height: 0 }, term: { column: 0, row: 0, width: 0, height: 0 } },
			})]),
		},
		{
			name: 'non-integer cell rect',
			code: 'GW_CLACK_SCHEMA',
			frame: () => frame({}, [node({
				geo: { layout: { x: 0, y: 0, width: 1, height: 1 }, term: { column: 0.5, row: 0, width: 1, height: 1 } },
			})]),
		},
	];
	for (const { name, code, frame: make } of cases) {
		test(`${name} -> ${code}`, () => {
			expect(() => encodeFrame(make() as ClackFrameV1)).toThrowError(
				expect.objectContaining({ code }),
			);
		});
	}

	test('payload over the byte limit is refused by the encoder (TC-U3)', () => {
		const fat = frame({}, [node({ attrs: { focusable: false, label: 'x'.repeat(LIMITS.attribute) } })]);
		expect(() => encodeFrame(fat)).not.toThrow();
		const many = frame({}, Array.from({ length: LIMITS.nodes }, (_, i) =>
			node({ key: `k${i}`, attrs: { focusable: false, label: 'y'.repeat(100) } }),
		));
		expect(() => encodeFrame(many)).toThrowError(expect.objectContaining({ code: 'GW_CLACK_LIMIT' }));
	});
});

describe('frame ordering through the real accept path (REQ-009, TC-U2)', () => {
	function accept(frames: ClackFrameV1[]) {
		const extension = clackTtyExtension();
		const { context, revisions } = recordingContext();
		const session = extension.createSession(context);
		for (const frame of frames) extension.accept(session, frame, context);
		return { session, revisions };
	}

	test('frames advance strictly by one', () => {
		const { session, revisions } = accept([frame({ frame: 1 }), frame({ frame: 2 }), frame({ frame: 3 })]);
		expect(revisions.map((revision) => revision.protocolFrame)).toEqual([1, 2, 3]);
		expect(session.frames().map((frame) => frame.frame)).toEqual([1, 2, 3]);
	});

	test('a skipped frame number is rejected and the last good revision survives', () => {
		const { context, revisions } = recordingContext();
		const extension = clackTtyExtension();
		const session = extension.createSession(context);
		extension.accept(session, frame({ frame: 1 }), context);
		expect(() => extension.accept(session, frame({ frame: 3 }), context)).toThrowError(
			expect.objectContaining({ code: 'GW_CLACK_FRAME' }),
		);
		expect(() => extension.accept(session, frame({ frame: 1 }), context)).toThrowError(
			expect.objectContaining({ code: 'GW_CLACK_FRAME' }),
		);
		expect(session.current()?.frame).toBe(1);
		expect(revisions).toHaveLength(1);
	});
});

describe('geometry truncation (REQ-007, TC-U4 support)', () => {
	test('Clay-compatible truncation with 1-based row offset', () => {
		const { layout, term } = geometryFor(
			{ x: 1.5, y: 0.5, width: 10.25, height: 3.75 },
			{ columns: 80, rows: 24, row: 1 },
		);
		expect(layout).toEqual({ x: 1.5, y: 0.5, width: 10.25, height: 3.75 });
		expect(term).toEqual({ column: 1, row: 0, width: 10, height: 4 });
	});

	test('viewport intersection clamps to the surface', () => {
		const { visible } = geometryFor(
			{ x: 70, y: 20, width: 40, height: 10 },
			{ columns: 80, rows: 24, row: 1 },
		);
		expect(visible).toEqual({ column: 70, row: 20, width: 10, height: 4 });
	});

	test('a node rendered fully outside the surface has no visible rect', () => {
		const { visible } = geometryFor(
			{ x: 0, y: 40, width: 10, height: 2 },
			{ columns: 80, rows: 24, row: 1 },
		);
		expect(visible).toBeUndefined();
	});
});

import { describe, expect, test } from 'vitest';
import type { ExtensionSessionContext, ExtensionRevision } from 'ghostwright';
import { clackTtyExtension, ClackTtySession, type TreeMatch } from '../src/extension.ts';
import type { ClackFrameV1, ClackNodeV1 } from '../src/protocol.ts';

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

const geo = { layout: { x: 0, y: 0, width: 40, height: 8 }, term: { column: 0, row: 0, width: 40, height: 8 } };

const demoFrame: ClackFrameV1 = {
	v: 1,
	frame: 1,
	surface: { columns: 80, rows: 24, row: 1 },
	focusStack: ['5'],
	nodes: [
		node({ key: '1', attrs: { role: 'group', label: 'hello', focusable: false }, geo }),
		node({ key: '2', name: 'text', parent: '1', order: 0 }),
		node({ key: '3', name: 'box', parent: '1', order: 1 }),
		node({ key: '4', name: 'box', parent: '3', order: 0 }),
		node({
			key: '5',
			name: 'input',
			parent: '3',
			order: 1,
			attrs: { role: 'textbox', label: 'say', input: true, focusable: true },
			states: { focused: true, focusRoot: true },
			geo: { layout: { x: 2, y: 6, width: 10, height: 3 }, term: { column: 2, row: 6, width: 10, height: 3 } },
		}),
		node({
			key: '6',
			name: 'input',
			parent: '3',
			order: 2,
			attrs: { role: 'textbox', label: 'to', input: true, focusable: true },
		}),
		node({ key: '7', name: 'box', parent: '1', order: 2, attrs: { focusable: false, custom: { kind: 'meta' } } }),
	],
};

function sessionWith(frame: ClackFrameV1): ClackTtySession {
	const extension = clackTtyExtension();
	let sequence = 0;
	const context: ExtensionSessionContext<ClackFrameV1> = {
		terminal: {} as ExtensionSessionContext<ClackFrameV1>['terminal'],
		screen: {} as ExtensionSessionContext<ClackFrameV1>['screen'],
		publish(commit): ExtensionRevision<ClackFrameV1> {
			return {
				sequence: ++sequence,
				timestamp: 0,
				extensionId: 'test',
				protocolFrame: commit.protocolFrame,
				screenSequence: 0,
				value: commit.value,
			};
		},
		diagnostic() {},
	};
	const session = extension.createSession(context);
	extension.accept(session, frame, context);
	return session;
}

describe('selector evaluation over a crafted tree (TC-U5, REQ-017)', () => {
	const session = sessionWith(demoFrame);

	test('tag selectors match element names', () => {
		expect(session.locator('input').matches().map((match) => match.key)).toEqual(['5', '6']);
	});

	test('attribute selectors expose semantic attributes', () => {
		expect(session.locator('[role="textbox"]').matches().map((match) => match.key)).toEqual(['5', '6']);
		expect(session.locator('[label="say"]').matches().map((match) => match.key)).toEqual(['5']);
		expect(session.locator('input[input]').matches().map((match) => match.key)).toEqual(['5', '6']);
		expect(session.locator('[focusable]').matches().map((match) => match.key)).toEqual(['5', '6']);
		expect(session.locator('[focused]').matches().map((match) => match.key)).toEqual(['5']);
		expect(session.locator('[focus-root]').matches().map((match) => match.key)).toEqual(['5']);
		expect(session.locator('[data-kind="meta"]').matches().map((match) => match.key)).toEqual(['7']);
	});

	test('combinators resolve over parent/order links', () => {
		expect(session.locator('box > text').matches().map((match) => match.key)).toEqual(['2']);
		expect(session.locator('box[label="hello"] > box > input[label="to"]').matches().map((match) => match.key)).toEqual(['6']);
		expect(session.locator('input[label="say"] + input').matches().map((match) => match.key)).toEqual(['6']);
		expect(session.locator('box[label="hello"] input').matches().map((match) => match.key)).toEqual(['5', '6']);
	});

	test('focus pseudos mirror the attribute form', () => {
		expect(session.locator('input:focus').matches().map((match) => match.key)).toEqual(['5']);
	});

	test('zero matches yield an empty list', () => {
		expect(session.locator('input[label="nope"]').matches()).toEqual([]);
	});
});

describe('match semantics and diagnostics (TC-U6, REQ-019)', () => {
	const session = sessionWith(demoFrame);

	test('nth selects deterministic document-ordered matches', () => {
		expect(session.locator('input').nth(0).unique().key).toBe('5');
		expect(session.locator('input').nth(1).unique().key).toBe('6');
		expect(session.locator('input').nth(1).matches()).toHaveLength(1);
	});

	test('nonnegative validation; beyond-count indices are lazy (empty), not errors', () => {
		expect(() => session.locator('input').nth(2)).not.toThrow();
		expect(session.locator('input').nth(2).matches()).toEqual([]);
		expect(() => session.locator('input').nth(-1)).toThrowError(
			expect.objectContaining({ code: 'GW_CLACK_LOCATOR_RANGE' }),
		);
		expect(() => session.locator('input').nth(1.5)).toThrowError(
			expect.objectContaining({ code: 'GW_CLACK_LOCATOR_RANGE' }),
		);
	});

	test('strict single-match requirement lists candidate keys', () => {
		try {
			session.locator('input').unique();
			expect.unreachable('unique() must throw on ambiguity');
		} catch (error) {
			const message = (error as Error).message;
			expect(message).toContain('matched 2');
			expect(message).toContain('5/input');
			expect(message).toContain('6/input');
		}
	});
});

describe('geometry bridge (REQ-020, TC-I8 support)', () => {
	const session = sessionWith(demoFrame);

	test('range prefers visible bounds and falls back to term', () => {
		const say = session.locator('input[label="say"]').unique();
		expect(say.range).toEqual({ column: 2, row: 6, width: 10, height: 3 });
		const group = session.locator('box[label="hello"]').unique();
		expect(group.range).toEqual({ column: 0, row: 0, width: 40, height: 8 });
	});

	test('a match without geometry fails with GW_CLACK_NO_GEOMETRY', () => {
		const text = session.locator('text').unique();
		expect(text.geo).toBeUndefined();
		expect(() => session.locator('text').region()).toThrowError(
			expect.objectContaining({ code: 'GW_CLACK_NO_GEOMETRY' }),
		);
	});
});

describe('selector bounds (TC-U4, REQ-018)', () => {
	const session = sessionWith(demoFrame);
	const cases: [string, string][] = [
		['4097 bytes', `box${':has(box)'.repeat(300)}`.slice(0, 4097)],
		['malformed syntax', 'box:'],
		['pseudo-element', 'box::before'],
		['unsupported traversal', 'box < input'],
		['unsupported pseudo', 'box:contains(x)'],
	];
	for (const [name, source] of cases) {
		test(`${name} is rejected before evaluation`, () => {
			expect(() => session.locator(source)).toThrowError(
				expect.objectContaining({
					code: expect.stringMatching(/^GW_CLACK_SELECTOR_(LIMIT|INVALID)$/),
				}),
			);
		});
	}
});

describe('revision replacement (REQ-016)', () => {
	test('locators resolve against the newest accepted frame', () => {
		const extension = clackTtyExtension();
		let sequence = 0;
		const context: ExtensionSessionContext<ClackFrameV1> = {
			terminal: {} as ExtensionSessionContext<ClackFrameV1>['terminal'],
			screen: {} as ExtensionSessionContext<ClackFrameV1>['screen'],
			publish(commit): ExtensionRevision<ClackFrameV1> {
				return {
					sequence: ++sequence,
					timestamp: 0,
					extensionId: 'test',
					protocolFrame: commit.protocolFrame,
					screenSequence: 0,
					value: commit.value,
				};
			},
			diagnostic() {},
		};
		const session = extension.createSession(context);
		extension.accept(session, demoFrame, context);
		const lazy = session.locator('[focused]');
		expect(lazy.matches().map((match) => match.key)).toEqual(['5']);

		const next: ClackFrameV1 = {
			...demoFrame,
			frame: 2,
			focusStack: ['6'],
			nodes: demoFrame.nodes.map((node) =>
				node.key === '6'
					? { ...node, states: { focused: true, focusRoot: true } }
					: node.key === '5'
						? { ...node, states: { focused: false, focusRoot: false } }
						: node,
			),
		};
		extension.accept(session, next, context);
		expect(lazy.matches().map((match) => match.key)).toEqual(['6']);
	});
});

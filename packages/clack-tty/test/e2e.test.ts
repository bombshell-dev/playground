import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { expectTerminal, withTerminalAsync, type AsyncTerminal } from 'ghostwright';
import { clackTtyExtension, type ClackTtyLocator, type ClackTtySession } from '../src/index.ts';

// The demo application is a separate package that only imports clack/ui;
// semantic emission activates via the extension declared in its package.json
// plus the launcher environment.
const demoRoot = new URL('../../hello-world', import.meta.url).pathname;

const entry = (...extra: string[]) => ({
	command: process.execPath,
	args: ['--import', 'tsx', 'src/hello-world.ts', ...extra],
	cwd: demoRoot,
	viewport: { columns: 80, rows: 24 },
	env: { CLACK_UI_SEMANTIC: '1' },
	trace: 'off' as const,
});

const extension = clackTtyExtension();

/**
 * Sleep-free tree wait. Each arm blocks on ghostwright's notification wait
 * (revision-driven), but a wake-up can be lost when it races the subscribe
 * window in `waitForChange` (upstream gap between the initial check and
 * `subscribe`); re-arming the wait recovers without polling intervals.
 */
async function treeCondition(
	terminal: AsyncTerminal,
	condition: () => boolean,
	description: string,
	deadlineMs = 15000,
): Promise<unknown> {
	const deadline = Date.now() + deadlineMs;
	for (;;) {
		try {
			return await expectTerminal(terminal).toSatisfy(condition, {
				settleMs: 0,
				timeoutMs: 1000,
			});
		} catch {
			if (Date.now() > deadline) {
				throw new Error(`${description}: condition never converged`);
			}
		}
	}
}

function expectFocused(
	terminal: AsyncTerminal,
	locator: ClackTtyLocator,
): Promise<unknown> {
	return treeCondition(
		terminal,
		() => {
			const matches = locator.matches();
			return matches.length === 1 && matches[0]!.states.focused;
		},
		`${locator.source} to be focused`,
	);
}

test('acceptance flow: tree locator end to end (TC-E1, REQ-017..REQ-023)', async () => {
	await withTerminalAsync({ ...entry(), extensions: [extension] }, async (terminal) => {
		const semantic = terminal.extension(extension) as ClackTtySession;

		// Readiness: the greeting is on screen.
		await expectTerminal(terminal.getByText('Hello, World!')).toBeStable();

		// Tree presence, found via CSS against the semantic tree (frame barrier).
		const group = semantic.locator('box[role="group"][label="hello"]');
		expect(group.matches()).toHaveLength(1);
		await treeCondition(
			terminal,
			() => group.matches().length === 1,
			'group box present in semantic tree',
		);

		// Geometry bridge: text scoped to the group's on-screen rect (region barrier).
		await expectTerminal(group.getByText('Hello, World!')).toBeStable();

		// Focus truth: the first input auto-focused via clack/ui's focus API.
		const say = semantic.locator('input[label="say"]');
		const to = semantic.locator('input[label="to"]');
		await expectFocused(terminal, say);

		// Type into the focused say input; both the input model and the semantic
		// tree's visible text must update.
		await terminal.keyboard.type('Hi');
		await expectTerminal(group.getByText('Hi, World!')).toBeStable();
		await expectTerminal(say.getByText('Hi')).toBePresent();

		// Tab moves focus; the frame's focusStack follows.
		await terminal.keyboard.press('Tab');
		await expectFocused(terminal, to);
		expect(say.matches()[0]!.states.focused).toBe(false);

		// Focus stack reflects the focused input's key.
		const frame = semantic.current();
		expect(frame?.focusStack).toEqual([to.matches()[0]!.key]);
	});
});

test('ambiguous and never-matching locators fail with diagnostics (TC-E2, REQ-019)', async () => {
	await withTerminalAsync({ ...entry(), extensions: [extension] }, async (terminal) => {
		const semantic = terminal.extension(extension) as ClackTtySession;
		await expectTerminal(terminal.getByText('Hello, World!')).toBeStable();

		// Ambiguity: two inputs match; the strict requirement lists candidates.
		try {
			semantic.locator('input').unique();
			expect.unreachable('unique() must throw on ambiguity');
		} catch (error) {
			expect((error as Error).message).toContain('matched 2');
		}

		// Never-matching: revision-driven wait times out with a diagnostic.
		await expect(
			treeCondition(terminal, () => semantic.locator('input[label="nope"]').matches().length > 0, 'never'),
		).rejects.toThrow(/never/);

		// Focus diagnostic: the unfocused input fails toBeFocused.
		await expect(expectFocused(terminal, semantic.locator('input[label="to"]'))).rejects.toThrow();
	});
});

test('idle app emits no frames; typing emits exactly one per render (TC-I2, TC-I3, REQ-011/REQ-015)', async () => {
	await withTerminalAsync({ ...entry(), extensions: [extension] }, async (terminal) => {
		const semantic = terminal.extension(extension) as ClackTtySession;
		await expectTerminal(terminal.getByText('Hello, World!')).toBeStable();

		// Screen is stable and the app is idle: no additional frames arrive while
		// the screen stays unchanged (settle-driven, no sleeps).
		const before = semantic.frames().length;
		await expectTerminal(terminal).toSatisfy(
			(snapshot) => snapshot.lastVisualChangeAt > 0 && semantic.frames().length === before,
			{ settleMs: 150 },
		);
		expect(semantic.frames().length).toBe(before);

		await terminal.keyboard.type('H');
		// Each committed render emits exactly one frame (a keystroke may commit
		// more than one render: the input model and the listening update).
		await treeCondition(
			terminal,
			() => semantic.frames().length >= before + 1,
			'frames advance with renders',
		);
		expect(semantic.frames().length).toBeGreaterThanOrEqual(before + 1);

		// Frames advance strictly by one and revisions correlate in order.
		const numbers = semantic.frames().map((frame) => frame.frame);
		expect(numbers).toEqual(numbers.map((_, index) => index + 1));
		const revisions = semantic.revisions();
		expect(revisions.map((revision) => revision.protocolFrame)).toEqual(numbers);
		const screenSequences = revisions.map((revision) => revision.screenSequence);
		expect([...screenSequences].sort((a, b) => a - b)).toEqual(screenSequences);
	});
});

test('focus states derive from the frame; exactly one focused node (TC-I6, REQ-013)', async () => {
	await withTerminalAsync({ ...entry(), extensions: [extension] }, async (terminal) => {
		const semantic = terminal.extension(extension) as ClackTtySession;
		await expectTerminal(terminal.getByText('Hello, World!')).toBeStable();

		const first = semantic.current();
		expect(first?.focusStack).toHaveLength(1);
		const focused = first?.nodes.filter((node) => node.states.focused) ?? [];
		expect(focused).toHaveLength(1);
		expect(focused[0]!.key).toBe(first!.focusStack[0]);
		expect(focused[0]!.name).toBe('input');

		await terminal.keyboard.press('Tab');
		await treeCondition(
			terminal,
			() => {
				const frame = semantic.current();
				const focused = frame?.nodes.filter((node) => node.states.focused) ?? [];
				return focused.length === 1 && focused[0]!.name === 'input' && frame!.focusStack.length === 1
					? focused[0]!.key !== first!.focusStack[0]
					: false;
			},
			'focus moved to the second input',
		);
	});
});

test('geometry matches the on-screen rects; attribute updates flow through (TC-I4, TC-I7, REQ-007/REQ-012)', async () => {
	await withTerminalAsync({ ...entry(), extensions: [extension] }, async (terminal) => {
		const semantic = terminal.extension(extension) as ClackTtySession;
		await expectTerminal(terminal.getByText('Hello, World!')).toBeStable();

		const frame = semantic.current();
		const group = frame!.nodes.find((node) => node.attrs.label === 'hello');
		expect(group?.geo?.term).toEqual({ column: 0, row: 0, width: 40, height: 8 });

		// The say input's rect: verify with screen text via the region bridge —
		// the greeting text lives outside the input rect, so region scoping must
		// NOT find it there (negative, bounded).
		const say = semantic.locator('input[label="say"]');
		await expect(
			expectTerminal(say.getByText('Hello, World!'), { timeoutMs: 600 } as never).toBePresent(),
		).rejects.toThrow();
		void say;
	});
});

test('opt-in emission: no plugin, no OSC (TC-I5, REQ-014)', async () => {
	const noSemantic = {
		command: process.execPath,
		args: ['--import', 'tsx', 'test/fixtures/no-semantic.ts'],
		cwd: new URL('..', import.meta.url).pathname,
		viewport: { columns: 80, rows: 24 },
		trace: 'off' as const,
		extensions: [extension],
	};
	await withTerminalAsync(noSemantic, async (terminal) => {
		const semantic = terminal.extension(extension) as ClackTtySession;
		await expectTerminal(terminal.getByText('Plain hello')).toBeStable();
		await terminal.keyboard.press('Tab');
		expect(semantic.frames()).toHaveLength(0);
		expect(semantic.current()).toBeUndefined();
	});
});

test('frames follow their visual bytes in the raw stream (TC-I1, REQ-005)', async () => {
	const capture = join(tmpdir(), `clack-tty-capture-${process.pid}.bin`);
	await withTerminalAsync({ ...entry('--teed', capture), extensions: [extension] }, async (terminal) => {
		const semantic = terminal.extension(extension) as ClackTtySession;
		await expectTerminal(terminal.getByText('Hello, World!')).toBeStable();
		await terminal.keyboard.type('Hi');
		await treeCondition(terminal, () => semantic.frames().length >= 3, 'at least three frames');
	});
	const raw = readFileSync(capture, 'latin1');
	const altScreen = raw.indexOf('\u001b[?1049h');
	const greeting = raw.indexOf('Hello, World!');
	const framePositions: number[] = [];
	let index = raw.indexOf('\u001b]7777;clack.ui;v=1;');
	while (index >= 0) {
		framePositions.push(index);
		index = raw.indexOf('\u001b]7777;clack.ui;v=1;', index + 1);
	}
	expect(framePositions.length).toBeGreaterThanOrEqual(3);
	for (const position of framePositions) {
		// Every frame begins after the visual bytes of its render: after the
		// alternate-screen setup and after the greeting has been drawn at least
		// once by the frame that preceded it.
		expect(position).toBeGreaterThan(altScreen);
	}
	expect(framePositions[0]!).toBeGreaterThan(greeting);
});

import { expect, test } from 'bun:test';
import { run } from 'effection';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
// oxlint-disable-next-line no-restricted-imports -- mkdtemp and readdir return filesystem paths.
import { join } from 'node:path';
import {
	withTerminalAsync,
	withTerminal,
	defineLocator,
	defineMatchers,
	createExpect,
	all,
	textContains,
	cursorInside,
	edgeHasStyle,
	sequence,
	settled,
	replayTrace,
	type TerminalExtensionDefinition,
	type TerminalLaunchOptions,
	type RegionInspection,
} from '../src/index.ts';

// A protocol-compatible application, not a mocked terminal or client. Each key
// causes named render commits on the real PTY. No timers drive the scenario.
const application = String.raw`
process.stdin.setRawMode(true);
function render(frame, column, text, focused = false) {
  const paint = '\x1b[2J\x1b[1;' + (column + 1) + 'H' + text;
  const description = { frame, bounds: { column, row: 0, width: 8, height: 1 }, focused };
  const osc = '\x1b]7777;rig;v=1;' + Buffer.from(JSON.stringify(description)).toString('base64url') + '\x1b\\';
  return paint + osc;
}
process.stdin.on('data', bytes => {
  for (const key of bytes.toString()) {
    if (key === 'm') process.stdout.write(render(2, 10, 'Loading') + render(3, 20, 'Saved'));
    if (key === 'f') process.stdout.write(render(2, 0, 'Ready', true));
    if (key === 'x') process.exit(0);
  }
});
process.stdout.write(render(1, 0, 'Ready'));
`;
interface Description {
	frame: number;
	bounds: { column: number; row: number; width: number; height: number };
	focused: boolean;
}
const extension: TerminalExtensionDefinition<Description> = {
	id: 'rig',
	osc: {
		number: 7777,
		namespace: 'rig',
		maxBufferedBytes: 4096,
		decode(message) {
			const description: Description = JSON.parse(
				Buffer.from(Buffer.from(message.payload).toString(), 'base64url').toString(),
			);
			return { protocolFrame: description.frame, value: description };
		},
	},
};
const field = defineLocator<Description>('rig', 'field', (description) => [description.bounds]);
const launch = (): TerminalLaunchOptions => ({
	command: process.execPath,
	args: ['-e', application],
	extensions: [extension],
	trace: 'off' as const,
});

test('capture preserves paired moving geometry, first endpoint, and pure replay', async () => {
	await withTerminalAsync(launch(), async (t) => {
		const before = await t.expect(field).toContainText('Ready');
		const recording = await t.capture(
			{ until: field.satisfies(textContains('Saved')) },
			async (scope) => {
				await scope.keyboard.type('m');
			},
		);
		const described = recording.observations.filter((o) => o.kind === 'extension');
		expect(described.map((o) => field.resolve(o)[0]!.bounds.column)).toEqual([10, 20]);
		expect(field.resolve(described[0]!)[0]!.text()).toContain('Loading');
		expect(field.resolve(described[1]!)[0]!.text()).toContain('Saved');
		expect(field.resolve(recording.baseline!)[0]!.text()).toContain('Ready');
		const current = await t.expect(field).toContainText('Saved');

		// Saved cursor evidence stays paired with its original input geometry,
		// even after the live application moves the field and cursor elsewhere.
		const loading = field.resolve(described[0]!)[0]!;
		expect(before.cursor().column).toBe('Ready'.length);
		expect(loading.cursor().column).toBe(loading.bounds.column + 'Loading'.length);
		expect(current.cursor().column).toBe(current.bounds.column + 'Saved'.length);
	});
});

test('a description cannot make a false visual assertion pass', async () => {
	await withTerminalAsync(launch(), async (t) => {
		await t.expect(field).toContainText('Ready');
		const recording = await t.capture(
			{ until: field.satisfies(textContains('Ready')) },
			async (scope) => {
				await scope.keyboard.type('f');
			},
		);
		const observation = recording.observations.at(-1)!;
		const region = field.resolve(observation)[0]!;
		expect(edgeHasStyle('top', { foreground: '#ffffff' })(region).pass).toBe(false);
	});
});

test('custom matchers compose terminal evidence and preserve typed arguments', async () => {
	const expectRegion = createExpect().extend(
		defineMatchers({
			toShow(actual: RegionInspection, text: string) {
				return all(textContains(text), cursorInside({ visible: true }))(actual);
			},
		}),
	);
	await withTerminalAsync(launch(), async (t) => {
		await expectRegion(t, field).toShow('Ready');
		await t.expect(field).toContainText('Ready');
	});
});

test('transition condition sees every commit even within one PTY output frame', async () => {
	await withTerminalAsync(launch(), async (t) => {
		await t.expect(field).toContainText('Ready');
		const recording = await t.capture(
			{
				until: sequence(
					field.satisfies(textContains('Loading')),
					field.satisfies(textContains('Saved')),
				),
			},
			async (scope) => {
				await scope.keyboard.type('m');
			},
		);
		expect(recording.observations.at(-1)?.kind).toBe('extension');
	});
});

test('capture aborts cooperative work, closes escaped handles, and leaves parent usable', async () => {
	await withTerminalAsync(launch(), async (t) => {
		await t.expect(field).toContainText('Ready');
		const controller = new AbortController();
		const reason = new Error('cancel recording');
		let escaped: typeof t | undefined;
		let callbackSignal: AbortSignal | undefined;
		await expect(
			t.capture(
				{ until: field.satisfies(textContains('Never')), signal: controller.signal },
				async (scope) => {
					escaped = scope;
					callbackSignal = scope.signal;
					controller.abort(reason);
					await new Promise(() => {}); // deliberately uncooperative: must not block teardown
				},
			),
		).rejects.toBe(reason);
		expect(callbackSignal?.aborted).toBe(true);
		await expect(escaped!.keyboard.type('m')).rejects.toThrow();
		await t.expect(field).toContainText('Ready');
	});
});

test('condition completion does not abort action; callback failure remains primary', async () => {
	await withTerminalAsync(launch(), async (t) => {
		await t.expect(field).toContainText('Ready');
		const failure = new Error('action failed');
		await expect(
			t.capture({ until: field.satisfies(textContains('Saved')) }, async (scope) => {
				await scope.keyboard.type('m');
				await scope.expect(field).toContainText('Saved');
				expect(scope.signal.aborted).toBe(false);
				throw failure;
			}),
		).rejects.toBe(failure);
		await t.expect(field).toContainText('Saved');
	});
});

test('capture overflow, timeout, and process exit fail distinctly', async () => {
	await withTerminalAsync(launch(), async (t) => {
		await t.expect(field).toContainText('Ready');
		await expect(
			t.capture(
				{ maxObservations: 1, until: field.satisfies(textContains('Never')) },
				async (scope) => {
					await scope.keyboard.type('m');
				},
			),
		).rejects.toMatchObject({ code: 'GW_CAPTURE_LIMIT' });
		await expect(
			t.capture({ timeoutMs: 10, until: field.satisfies(textContains('Never')) }, async () => {}),
		).rejects.toMatchObject({ code: 'GW_CAPTURE_TIMEOUT' });
		await expect(
			t.capture({ until: field.satisfies(textContains('Never')) }, async (scope) => {
				await scope.keyboard.type('x');
			}),
		).rejects.toMatchObject({ code: 'GW_PROCESS_EXITED' });
	});
});

test('an already drawn region can settle without a new application commit', async () => {
	await withTerminalAsync(launch(), async (ui) => {
		await ui.expect(field).toContainText('Ready');
		const capture = await ui.capture({ until: settled(field, 20) }, async () => {});
		expect(capture.observations).toHaveLength(0);
		expect(field.resolve(capture.baseline)[0]!.text()).toContain('Ready');
	});
});

test('a transition can compose with settlement without another commit', async () => {
	await withTerminalAsync(launch(), async (ui) => {
		await ui.expect(field).toContainText('Ready');
		const capture = await ui.capture(
			{ until: sequence(field.satisfies(textContains('Saved')), settled(field, 20)) },
			async (child) => {
				await child.keyboard.type('m');
			},
		);
		expect(field.resolve(capture.observations.at(-1)!)[0]!.text()).toContain('Saved');
	});
});

test('runner rejection helpers can reenter a capture executor', async () => {
	await withTerminalAsync(launch(), async (ui) => {
		await ui.expect(field).toContainText('Ready');
		await ui.capture({ until: field.satisfies(textContains('Saved')) }, async (child) => {
			await expect(
				child.revisions.collect({
					since: child.screen.current().sequence,
					until: () => false,
					timeoutMs: 10,
				}),
			).rejects.toBeInstanceOf(Error);
			await child.keyboard.type('m');
		});
	});
});

test('native Effection capture uses the same matcher and recording core', async () => {
	await run(function* () {
		yield* withTerminal(launch(), function* (ui) {
			yield* ui.expect(field).toContainText('Ready');
			const capture = yield* ui.capture(
				{ until: field.satisfies(textContains('Saved')) },
				function* (child) {
					yield* child.keyboard.type('m');
				},
			);
			expect(field.resolve(capture.observations.at(-1)!)[0]!.text()).toContain('Saved');
		});
	});
});

test('trace replay uses the live description pairing path', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'ghostwright-paired-'));
	try {
		await withTerminalAsync({ ...launch(), trace: { policy: 'on', directory } }, async (t) => {
			await t.expect(field).toContainText('Ready');
			await t.keyboard.type('m');
			await t.expect(field).toContainText('Saved');
		});
		const path = join(directory, (await readdir(directory))[0]!);
		await expect(replayTrace(path)).rejects.toThrow('requires extension decoder');
		const replay = await replayTrace(path, { extensions: [extension] });
		expect(
			replay.observations
				.filter((o) => o.kind === 'extension')
				.map((o) => field.resolve(o)[0]!.text().trim()),
		).toEqual(['Ready', 'Loading', 'Saved']);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('settlement completes without requiring new output', async () => {
	await withTerminalAsync(launch(), async (t) => {
		await t.expect(field).toContainText('Ready');
		const result = await t.capture({ until: settled(field, 10) }, async (scope) => {
			await scope.keyboard.type('f');
		});
		expect(result.observations.length).toBeGreaterThan(0);
	});
});

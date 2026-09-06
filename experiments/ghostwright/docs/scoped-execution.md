# Scoped observations and assertions

## Evidence

Ghostty-decoded cells, styles, and cursor state are the assertion evidence. An optional OSC description provides identity and geometry. It cannot prove focus, input value, or application behavior.

The output pipeline publishes descriptions with the immutable screen that precedes their OSC boundary. Two descriptions can share one screen snapshot. A PTY read is not a render boundary. Unregistered applications still get screen observations, but overwritten intermediate states cannot be recovered.

`RegionLocator` is an immutable query. It owns no session or pending work. `resolve(observation)` produces `RegionInspection` values tied to that observation. Inspections retain original bounds separately from viewport clipping. An offscreen top border does not become the first visible row.

Without OSC, `defineScreenLocator(source, resolve)` passes a `ScreenSnapshot` to a pure resolver that returns zero or more rectangles. It resolves screen observations through the same inspection and execution layer. The [Vim/netrw spike](../examples/vim-netrw/README.md) demonstrates an authored spatial adapter, including its deliberate limits.

## Async API

```ts
import { withTerminalAsync, textContains, sequence } from 'ghostwright';
import { clackTtyExtension, expectUI, locator } from '@ghostwright/clack-tty';

const name = locator('input[label="name"]');
const notice = locator('text[label="status"]');

await withTerminalAsync(
	{
		command: 'node',
		args: ['app.js'],
		env: { CLACK_UI_SEMANTIC: '1' },
		extensions: [clackTtyExtension()],
	},
	async (ui) => {
		await expectUI(ui, name).toHaveInputFocus();
		await ui.keyboard.type('Ryan');
		await ui.expect(name).toContainText('Ryan');

		const capture = await ui.capture(
			{
				until: sequence(
					notice.satisfies(textContains('Saving')),
					notice.satisfies(textContains('Saved')),
				),
				timeoutMs: 4000,
			},
			async (child) => {
				await child.keyboard.press('Enter');
			},
		);

		for (const observation of capture.observations) {
			// Pure historical evaluation. It never reads the current session.
			const regions = notice.resolve(observation);
			for (const region of regions) console.log(region.text());
		}
	},
);
```

The example requires an application that emits the named descriptions. See the pizza tests for runnable journeys.

## Matchers

Matchers are synchronous functions from terminal evidence to a result with `pass`, `expected`, and `actual`. The executor supplies subscriptions, retries, deadlines, and cancellation.

```ts
import { createExpect, defineMatchers, textContains, type RegionInspection } from 'ghostwright';

const expect = createExpect().extend(
	defineMatchers({
		toShow(actual: RegionInspection, text: string) {
			return textContains(text)(actual);
		},
	}),
);

await expect(ui, name).toShow('Ryan');
```

Extension returns a new typed factory. Registration is local. There is no global registry or declaration merging. Native Effection callers use `yield* expect.operation(ui, name).toShow('Ryan')`.

## Capture lifetime

The executor establishes the baseline, subscription, limits, and deadline before it starts the callback. The baseline is separate from recorded observations.

- A matching observation stops recording and remains in the result.
- Later observations in the same transport batch stay out of that capture.
- Recording completion does not end the callback. Capture waits for both.
- The deadline stays active while the callback finishes.
- Abort, callback failure, timeout, and storage overflow stop recording and cancel child-owned work.
- Process EOF is checked after queued terminal output is inspected.
- A failed capture leaves its parent session open.

`sequence(a, b)` requires separate observations. A baseline does not prove a transition. `settled(locator, ms)` tracks region contents and cursor evidence. Its `geometry` option tracks position and size instead. Region settlement does not restart for unrelated animation. It suspends while output has no fresh associated description. `elapsed(ms)` is available for an explicit duration.

Capture defaults to 1,000 observations and a 64 MiB serialized-size estimate. Exceeding either bound fails with `GW_CAPTURE_LIMIT`; it does not silently discard the beginning.

The capture callback receives a child executor. Work through an outer `ui` remains parent-owned. Nesting does not rebind existing handles. Closed executors reject new scoped work.

Each executor exposes its scope-owned `signal`. The signal aborts on normal scope completion as well as failure. An optional capture signal adds cancellation; it does not replace scope ownership. The returned promise distinguishes success from failure. Arbitrary JavaScript promises cannot be forcibly cancelled, and cancellation cannot undo bytes already written to the PTY.

Async callbacks begin outside the Effection dispatcher. This permits runner assertion helpers that drain promises synchronously to call back into the executor without blocking its dispatcher.

## Effection API

`withTerminal` uses the same session resource, matcher executor, and capture operation:

```ts
yield *
	withTerminal(options, function* (ui) {
		yield* ui.expect(name).toContainText('Ryan');
		yield* ui.capture({ until: notice.satisfies(textContains('Saved')) }, function* (child) {
			yield* child.keyboard.press('Enter');
		});
	});
```

## Replay

`replayTrace(path, { extensions: [clackTtyExtension()] })` uses the live output splitter and description-pairing pipeline. Traces record required decoder identities and the initial viewport. Replay rejects missing decoders and traces whose beginning was evicted. Replay returns both screen revisions and paired observations.

## Boundaries still worth revisiting

The older text-locator, screen-revision, history, and graphics APIs remain available. They have not all been redesigned into pure locator descriptions. Use the scoped region API above for the new ownership and capture model. Runner fixtures and bound-locator convenience methods are not part of this pass.

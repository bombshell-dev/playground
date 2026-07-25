# Choosing locators and assertions

Ghostwright separates first appearance, visual convergence, stable absence, and transient revision history. Choosing the right assertion is the main defense against flaky terminal tests.

## Decision table

| Question                                            | Assertion           |
| --------------------------------------------------- | ------------------- |
| Has this text appeared yet?                         | `toBePresent()`     |
| Has the final visible UI settled?                   | `toBeStable()`      |
| Has this text remained gone?                        | `toBeAbsent()`      |
| Have several visible conditions converged together? | `toSatisfy()`       |
| Did a fleeting screen state occur after an action?  | `toHaveShown()`     |
| Did fleeting text occur after an action?            | `toHaveShownText()` |

All waits evaluate current state and subscribe to revisions. They do not use fixed-interval polling.

## `toBePresent`: readiness and first appearance

```ts
await expectTerminal(terminal.getByText('Ready')).toBePresent({
	timeoutMs: 5_000,
});
```

Use this as a readiness barrier or when first appearance is sufficient. It completes on the first unique match and does not wait for the surrounding screen to stop changing.

## `toBeStable`: final visible state

```ts
await expectTerminal(terminal.getByText('Saved')).toBeStable({
	timeoutMs: 5_000,
	settleMs: 100,
});
```

The locator must match while the screen remains visually unchanged for the settle duration. Visual identity includes:

- Visible cell text and styles
- Cursor position, shape, visibility, and blinking
- Active primary or alternate buffer
- Viewport dimensions

Raw bytes, bell, title, clipboard, and repeated identical redraws do not restart visual stability unless they alter those fields.

The settle clock starts at the session's last visual change, not at assertion invocation. If the matching screen has already been stable for 100 ms, the assertion can complete immediately.

## `toBeAbsent`: stable disappearance

```ts
await expectTerminal(terminal.getByText('Loading')).toBeAbsent({
	timeoutMs: 5_000,
	settleMs: 100,
});
```

The locator must remain absent for the settle duration. If it reappears, the absence window restarts.

## `toSatisfy`: compound convergence

Use a terminal predicate when one stable screen must satisfy several conditions:

```ts
await expectTerminal(terminal).toSatisfy(
	(snapshot) => {
		const text = snapshot.lines.map((line) => line.text).join('\n');
		return text.includes('Status: complete') && text.includes('Items: 12');
	},
	{ timeoutMs: 5_000, settleMs: 100 },
);
```

The predicate is evaluated against immutable `ScreenSnapshot` values and must remain true through visual settlement.

Prefer multiple locators when the conditions are independently meaningful. Use `toSatisfy` when their atomic relationship is the behavior under test.

## `toHaveShown`: transient revision history

Terminal applications can paint a state and replace it before the test resumes:

```text
idle → saving → complete
```

Capture the action receipt and search retained revisions from that boundary:

```ts
const action = await terminal.keyboard.press('Enter');

await expectTerminal(terminal).toHaveShown(
	(snapshot) => snapshot.lines.some((line) => line.text.includes('Saving')),
	{ since: action, timeoutMs: 5_000 },
);
```

For text only:

```ts
await expectTerminal(terminal).toHaveShownText('Saving', {
	since: action,
});
```

If `since` is omitted, Ghostwright uses the most recent completed user action when available. Explicit receipts are clearer when multiple actions occur near the assertion.

Transient assertions search revision history; they do not require the matching state to remain visible.

## Strict text locators

```ts
const locator = terminal.getByText('Open');
```

Locators are:

- Lazy: evaluated against the latest snapshot
- Visible-viewport only
- Literal and case-sensitive
- Restricted to one physical row
- Grapheme- and cell-aware
- Strict for actions and unique assertions

Zero matches wait until timeout. Multiple matches fail immediately with candidate ranges.

Resolve duplicates deliberately:

```ts
terminal.getByText('Open').nth(1);

terminal.getByText('Open').region({ column: 40, row: 0, width: 40, height: 24 });
```

`nth()` uses zero-based row-major ordering. `region()` uses zero-based cell coordinates.

Exact matching compares the full physical row after trailing spaces are removed:

```ts
terminal.getByText('Ready', { exact: true });
```

Ghostwright does not normalize Unicode, fold case, cross rows, or search scrollback for actionable locators.

## Process exit during an assertion

A direct-child exit does not immediately discard the final screen. Ghostwright drains PTY output until EOF or the configured deadline and evaluates the final snapshot. An unmet condition then reports process exit and drain state in its diagnostic.

## History eviction

Revision history is bounded. A transient assertion whose baseline is older than retained history throws `HistoryEvictedError` rather than silently searching an incomplete range.

If a legitimate test needs a longer interval, increase session history deliberately:

```ts
{
  history: {
    maxRevisions: 2_000,
    maxRawBytes: 8 * 1024 * 1024,
    maxDecodedBytes: 128 * 1024 * 1024,
  },
}
```

## PTY read-boundary limitation

One revision boundary corresponds to one PTY-host read, resize, or reset evaluation—not a separately rendered pixel frame. The kernel may combine application writes before Ghostwright receives them. A transient state overwritten within one kernel-coalesced read cannot be recovered, and Ghostwright does not manufacture per-byte revisions.

Ghostwright never debounces or combines separate sidecar output frames.

## Avoid these patterns

Do not poll:

```ts
while (!terminal.screen.getText().includes('Ready')) {
	await sleep(25);
}
```

Do not add readiness sleeps:

```ts
await sleep(500);
expect(terminal.screen.getText()).toContain('Ready');
```

Use the corresponding revision assertion instead. A real sleep is appropriate only when elapsed time itself is the behavior under test or a negative scenario has no positive revision signal; document why it is necessary.

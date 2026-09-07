# AGENTS.md — Using Ghostwright

Use this guide when a task asks you to blackbox test a terminal CLI or TUI with Ghostwright.

## Objective

Test the application from the outside. Launch its real command under a PTY, interact through terminal input, and assert only visible terminal state or process behavior. Do not import application internals or add test-only instrumentation to the application.

## Fast workflow

1. Identify the repository's existing test runner and conventions.
2. Identify the direct executable, argument array, cwd, and any nonreserved environment values.
3. Use `await using` with `launchTerminal`, or the `withTerminal` callback helper. Effection uses `ghostwright/effection`.
4. Wait for a visible readiness condition before acting.
5. Await every action. Save the receipt when a transient assertion follows.
6. Use a stable assertion for final UI state and revision history for fleeting state.
7. Verify process exit when exit behavior matters.
8. Run the focused test. On failure, inspect the attached `.ghostwright` artifacts before changing timeouts.

## Public query and assertion model

Use `terminal.screen.getBy/queryBy/findBy` with a locator recipe, or their `ByText` and adapter-owned `BySelector` conveniences. The `All` forms return arrays. `get` and `query` inspect now; `find` waits. A result is frozen evidence, not a live element. Query again inside `terminal.waitFor` when checking a changing value.

Jest and Vitest can use `ghostwright/jest` and `ghostwright/vitest` to install immediate terminal matchers on their own `expect`. Keep keyboard and mouse input outside retried assertions. Capture observations when intermediate states matter. The README and pizza examples show this style.

`launchTerminal` supports `await using`; the `withTerminal` callback form also records body failures. Bare disposal cannot detect a test assertion failure. Use the Vitest launch fixture, the callback form, or `trace: 'on'` when artifacts are required.

The lower-level `expectTerminal` helpers below remain available for existing revision/history workflows.

## Lower-level async template

```ts
import { expect, test } from 'bun:test';
import { expectTerminal, withTerminal } from 'ghostwright';

test('interactive happy path', async () => {
	await withTerminal(
		{
			command: 'bun',
			args: ['src/cli.ts'],
			cwd: process.cwd(),
			viewport: { columns: 80, rows: 24 },
		},
		async (terminal) => {
			await expectTerminal(terminal.getByText('Ready')).toBePresent();

			const action = await terminal.keyboard.press('Enter');

			await expectTerminal(terminal).toHaveShownText('Working', {
				since: action,
			});
			await expectTerminal(terminal.getByText('Complete')).toBeStable();

			const status = await terminal.process.waitForExit();
			expect(status.exitCode).toBe(0);
		},
	);
});
```

Replace the command, arguments, and visible strings with values from the target application. Ghostwright does not insert an implicit shell. Launch `/bin/sh`, `bash`, or another shell explicitly only when shell syntax is part of the intended test.

## Assertion selection

| Intent                                    | Use                                                          |
| ----------------------------------------- | ------------------------------------------------------------ |
| First appearance or readiness barrier     | `expectTerminal(locator).toBePresent()`                      |
| Final visually settled state              | `expectTerminal(locator).toBeStable()`                       |
| Text must remain absent                   | `expectTerminal(locator).toBeAbsent()`                       |
| Compound stable screen condition          | `expectTerminal(terminal).toSatisfy(predicate)`              |
| Fleeting screen condition after an action | `expectTerminal(terminal).toHaveShown(predicate, { since })` |
| Fleeting text after an action             | `expectTerminal(terminal).toHaveShownText(text, { since })`  |

Assertions are revision-driven. Do not add fixed sleeps for readiness or convergence. A sleep is acceptable only when elapsed time itself is the behavior under test or a negative assertion has no positive revision signal; leave a comment explaining that choice.

## Locator rules

- Text locators search the current visible viewport, not scrollback or application data structures.
- Matching is literal, case-sensitive, and confined to one physical row.
- Locator actions are strict: zero matches wait; multiple matches fail.
- Resolve duplicates deliberately with `.nth(index)` or `.region(rect)`.
- Coordinates are zero-based `{ column, row }`.
- Locator clicks use ordinary terminal mouse reporting and do not bypass application modes.

## Actions

```ts
await terminal.keyboard.press('Enter');
await terminal.keyboard.press({ key: 'c', control: true });
await terminal.keyboard.type('hello');
await terminal.keyboard.paste('multiline\ntext');
await terminal.keyboard.write(new Uint8Array([0x1b]));

await terminal.mouse.move({ column: 4, row: 2 });
await terminal.mouse.click({ column: 4, row: 2 }, { button: 'left' });
await terminal.mouse.wheel({ column: 4, row: 2, deltaRows: 1 });

await terminal.resize({ columns: 100, rows: 30 });
await terminal.process.signal('SIGTERM', 'process-group');
```

`keyboard.press({ key: "c", control: true })` travels through terminal input and line discipline. It is not equivalent to `process.signal("SIGINT")`.

## Stable versus transient state

Save an action receipt when the target state may appear and disappear quickly:

```ts
const action = await terminal.keyboard.press('Enter');

await expectTerminal(terminal).toHaveShownText('Saving', {
	since: action,
});
await expectTerminal(terminal.getByText('Saved')).toBeStable();
```

Do not replace `toHaveShownText` with a sleep followed by a current-screen read. The current snapshot may already have overwritten the transient state.

## Screen inspection

```ts
const snapshot = terminal.screen.current();
const text = terminal.screen.getText();
const cell = terminal.screen.getCell({ column: 0, row: 0 });
const changes = terminal.screen.changedCells(previousSnapshot);
const raw = terminal.screen.rawOutput();
const clipboard = terminal.screen.clipboard();
```

Prefer locators and assertions for ordinary tests. Use low-level cells, styles, and modes when geometry or terminal semantics are the behavior under test.

## Failure workflow

When a test fails:

1. Read the thrown diagnostic, including viewport, cursor, modes, process state, candidates, and changed rows.
2. Open the attached artifact path.
3. Read `failure.txt`.
4. Read `final-screen.txt` with its row and column rulers.
5. Inspect recent actions and revisions in `trace.jsonl`.
6. Inspect `output.bin` only when exact bytes matter.
7. Determine whether the expected state was absent, ambiguous, transient, evicted, or hidden by process exit.
8. Do not increase timeouts until the cause is understood.

The default trace policy is `retain-on-failure`. Mark sensitive typing or paste input with `{ trace: "redact" }`, or use session `trace: "off"`. Application output may still contain secrets.

## Completion checklist

Before reporting success:

- The test launches the real command and does not instrument application internals.
- Readiness and final state use revision-driven assertions.
- Actions are awaited.
- Transient assertions use an action receipt.
- Duplicate locators are explicitly disambiguated.
- Raw sleeps are absent or justified.
- Focused tests pass.
- The terminal scope closes on success and failure.

## Further reading

- [`docs/agent-quickstart.md`](docs/agent-quickstart.md)
- [`docs/choosing-assertions.md`](docs/choosing-assertions.md)
- [`docs/interaction-recipes.md`](docs/interaction-recipes.md)
- [`docs/debugging-failures.md`](docs/debugging-failures.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`examples/`](examples/)

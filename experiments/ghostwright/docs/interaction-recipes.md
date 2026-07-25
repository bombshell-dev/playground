# Interaction recipes

These recipes use the async API. With Effection, replace `await` with `yield*` and `withTerminalAsync` with `withTerminal`; operation names and semantics remain the same.

## Launch an interactive command

```ts
await withTerminalAsync(
	{
		command: 'my-cli',
		args: ['--interactive'],
		cwd: process.cwd(),
		env: { APP_MODE: 'test' },
		viewport: { columns: 80, rows: 24 },
	},
	async (terminal) => {
		await expectTerminal(terminal.getByText('Ready')).toBePresent();
	},
);
```

The callback owns the session. Normal return, throw, assertion failure, and cancellation all close the terminal and application process group before the outer operation completes.

## Type into a canonical shell prompt

```ts
await expectTerminal(terminal.getByText('Name: ')).toBePresent();
await terminal.keyboard.type('Ada');
await terminal.keyboard.press('Enter');
await expectTerminal(terminal.getByText('Hello, Ada!')).toBeStable();
```

`keyboard.type()` sends user key input without an implicit delay. `Enter` is a separate key action.

## Keyboard shortcuts

```ts
await terminal.keyboard.press({ key: 'c', control: true });
await terminal.keyboard.press({ key: 'Tab', shift: true });
await terminal.keyboard.press({ key: 'x', alt: true });
```

Keyboard encoding uses current Ghostty terminal modes, including application cursor keys, backarrow mode, and Kitty keyboard flags.

User Control-C is terminal input. In canonical mode with `ISIG`, line discipline normally delivers `SIGINT`; in raw mode the application receives byte `0x03`. Administrative signaling is separate:

```ts
await terminal.process.signal('SIGINT', 'child');
await terminal.process.signal('SIGTERM', 'process-group');
```

## Paste

```ts
await terminal.keyboard.paste('first line\nsecond line');
```

Paste uses Ghostty paste encoding and active bracketed-paste mode. It is not implemented as delayed key-by-key typing.

Redact sensitive input from traces:

```ts
await terminal.keyboard.type(secret, { trace: 'redact' });
await terminal.keyboard.paste(secret, { trace: 'redact' });
```

Application output can still expose the value.

## Raw bytes

```ts
await terminal.keyboard.write(new Uint8Array([0x1b, 0x5b, 0x41]));
```

Use raw input only when exact bytes are part of the test. Prefer `press`, `type`, or `paste` for mode-aware interaction.

## Click visible text

```ts
const action = await terminal.getByText('Save', { exact: true }).click();

await expectTerminal(terminal).toHaveShownText('Saving', {
	since: action,
});
await expectTerminal(terminal.getByText('Saved')).toBeStable();
```

The locator resolves to cell geometry and performs ordinary terminal mouse behavior. If mouse reporting is disabled, no bytes are delivered to the child and the receipt reports `deliveredToChild: false`.

## Coordinate mouse interaction

```ts
await terminal.mouse.move({ column: 10, row: 4 });
await terminal.mouse.down({ column: 10, row: 4 }, { button: 'left' });
await terminal.mouse.up({ column: 10, row: 4 }, { button: 'left' });

await terminal.mouse.drag({ column: 2, row: 3 }, { column: 20, row: 3 }, { button: 'left' });
```

Coordinates are zero-based terminal cells. Out-of-range coordinates fail before input is sent.

## Wheel

```ts
await terminal.mouse.wheel({
	column: 10,
	row: 4,
	deltaRows: 1,
});
```

Positive row deltas scroll down; negative deltas scroll up. `deltaColumns` sends horizontal wheel input.

## Resize

```ts
await terminal.resize({
	columns: 100,
	rows: 30,
});

await expectTerminal(terminal).toSatisfy(
	(snapshot) => snapshot.viewport.columns === 100 && snapshot.viewport.rows === 30,
	{ timeoutMs: 5_000, settleMs: 100 },
);
```

Ghostwright updates both the Ghostty engine and kernel PTY dimensions. The foreground process group receives ordinary `SIGWINCH`; no synthetic resize sequence is injected into stdin.

## Process status and exit

```ts
const running = terminal.process.status();

const status = await terminal.process.waitForExit({
	timeoutMs: 5_000,
});

expect(status.exitCode).toBe(0);
expect(status.signal).toBeNull();
expect(status.ptyEof).toBe(true);
```

Direct-child exit and PTY EOF are tracked separately. Ghostwright drains final output before completing exit waits.

## Read cells and styles

```ts
const snapshot = terminal.screen.current();
const cell = terminal.screen.getCell({ column: 4, row: 2 });

expect(cell.text).toBe('A');
expect(cell.style.bold).toBe(true);
expect(cell.style.foreground).toEqual({
	kind: 'palette',
	index: 42,
});
```

Wide leading cells have `width: 2`. Their continuation cell has `width: 0`, `continuation: true`, and empty text. Combining codepoints remain together in the leading cell's grapheme string.

## Verify alternate-screen restoration

A strong outside-in conformance scenario is:

1. Launch interactive Bash.
2. Print `hello world` on the primary screen.
3. Open vi and verify the alternate buffer is active.
4. Exit vi with Escape, `:q!`, Enter.
5. Verify the primary buffer is active and `hello world` is still visible.

Runnable versions:

- [`../examples/async/bash-vi-roundtrip.test.ts`](../examples/async/bash-vi-roundtrip.test.ts)
- [`../examples/effection/bash-vi-roundtrip.test.ts`](../examples/effection/bash-vi-roundtrip.test.ts)

## Effection form

```ts
import { run } from 'effection';
import { expectTerminal, withTerminal } from 'ghostwright';

await run(function* () {
	return yield* withTerminal(options, function* (terminal) {
		yield* expectTerminal(terminal.getByText('Ready')).toBePresent();
		yield* terminal.keyboard.press('Enter');
		yield* expectTerminal(terminal.getByText('Done')).toBeStable();
	});
});
```

Effection cancellation halts the scoped operation and triggers the same terminal and process-group cleanup as the async facade.

# Debugging failures

Ghostwright failures are designed for coding agents to diagnose from the thrown error and plain files without attaching a debugger or rerunning the application interactively.

## Default behavior

The default trace policy is `retain-on-failure`:

```ts
await withTerminalAsync(
  {
    command: "my-cli",
    name: "save-flow",
  },
  async (terminal) => {
    // ...
  },
);
```

A successful callback writes no artifact. A callback or assertion failure writes artifacts before cleanup, attaches the path to the original error, and rethrows that original error as the primary failure.

Configure the directory or policy:

```ts
{
  trace: {
    policy: "retain-on-failure",
    directory: ".ghostwright",
    redactArgumentIndexes: [1],
  },
}
```

Use `trace: "on"` to retain successful sessions or `trace: "off"` for sensitive/minimal sessions.

## Read the thrown diagnostic first

An assertion diagnostic includes:

- Expected condition
- Timeout and settle configuration
- Current viewport and active buffer
- Cursor position and state
- Relevant terminal modes
- Process state and PTY EOF state
- Recent actions
- Changed rows
- Retained history range
- Closest visible text candidates
- Screen text with zero-based rulers
- Artifact path, when retained

Do not start by increasing the timeout. First classify the failure.

## Artifact layout

```text
.ghostwright/<session>/
├── metadata.json
├── trace.jsonl
├── output.bin
├── final-screen.txt
└── failure.txt
```

### `failure.txt`

Start here. It contains the primary error, process state, viewport, cursor, active buffer, artifact path, and final visible screen.

### `final-screen.txt`

Use row and column rulers to confirm:

- Whether expected text is actually visible
- Whether coordinates are off by one
- Whether the application rendered into a different region
- Whether the cursor or alternate screen is active
- Whether clipping or wrapping changed geometry

### `trace.jsonl`

Each line is one ordered event with a session sequence and monotonic timestamp. Search for:

```text
"type":"action"
"type":"output"
"type":"terminal-effect"
"type":"revision"
"type":"process-exit"
"type":"pty-eof"
"type":"cleanup"
```

Correlate the final user action with subsequent output and revisions. Raw bytes are referenced by offset and length rather than lossy JSON text.

### `output.bin`

This binary blob contains retained PTY output and nonredacted input referenced by trace events. Inspect it when exact escape sequences, invalid UTF-8, or terminal responses matter.

### `metadata.json`

Use metadata to verify reproduction inputs:

- Ghostwright and artifact versions
- Ghostty commit and WASM checksum
- PTY-host protocol and checksum
- Runtime, OS, and architecture
- Command and arguments
- cwd
- Explicit environment key names
- Deterministic terminal profile

Environment values and the complete inherited environment are not serialized.

## Common failures

### `StrictLocatorError`

The query matched more than one visible range. Read the candidate ranges and disambiguate:

```ts
terminal.getByText("Open").nth(1);

terminal
  .getByText("Open")
  .region({ column: 40, row: 0, width: 40, height: 24 });
```

Do not choose an arbitrary duplicate implicitly.

### `TerminalAssertionError`

The condition did not converge before timeout. Check:

1. Did the expected text differ in case, spacing, or physical row?
2. Was the match ambiguous?
3. Did the state appear only transiently?
4. Did visual changes continuously restart settlement?
5. Was the application waiting for input or a terminal response?

Use `toHaveShown` instead of `toBeStable` when the state is intentionally fleeting.

### `ProcessExitedError`

The direct child exited and final PTY drain completed before the condition could become true. Inspect exit code/signal, final screen, and event order. A process exit is not reported until final output has been evaluated.

### `HistoryEvictedError`

The requested transient baseline is older than retained revisions. Use a more recent action receipt or increase explicit history limits. Ghostwright never silently searches incomplete history.

### `ReservedEnvironmentError`

The launch attempted to override profile-owned identity:

```text
TERM
TERMINFO
COLORTERM
TERM_PROGRAM
TERM_PROGRAM_VERSION
```

Remove those explicit values. Ghostwright applies its deterministic profile after inherited/application environment merging.

### `HostCommandTimeoutError`

The native PTY host did not acknowledge a command before its deadline. The error records command kind, sequence, deadline, process-group ID, and fallback cleanup result. Treat this as a host/lifecycle problem rather than an assertion timeout.

### `DenoPermissionError`

Run again with the exact path-scoped `--allow-read`, `--allow-run`, and environment permission reported by the error. Avoid broad `-A` unless the surrounding project already requires it.

## Sensitive data

Common secret-like environment keys are redacted from trace metadata. Mark typed or pasted input explicitly:

```ts
await terminal.keyboard.type(password, { trace: "redact" });
await terminal.keyboard.paste(token, { trace: "redact" });
```

Redacted events retain type and length but not content. Application output, unmarked input, command arguments, and cwd may still contain secrets. Use argument-index redaction and `trace: "off"` where appropriate.

Trace directories and files use private POSIX permissions when supported.

## Agent triage checklist

1. Preserve the original failure and artifact directory.
2. Read `failure.txt` and `final-screen.txt`.
3. Compare expected text to visible physical rows.
4. Check strict locator candidates.
5. Find the latest action in `trace.jsonl`.
6. Check whether the target state exists in retained revisions.
7. Check process exit, EOF, and cleanup ordering.
8. Inspect raw bytes only if terminal protocol behavior is relevant.
9. Change the locator/assertion/action based on evidence.
10. Rerun the focused test; do not mask the problem with a sleep.

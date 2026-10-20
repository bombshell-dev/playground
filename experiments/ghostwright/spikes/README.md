# In-process terminal connection spike

`in-process.ts` connects injected application streams to Ghostwright's existing
Ghostty WASM engine, output/OSC decoder, observations, screen queries, and wait
executor. It does not launch a command or require a native PTY host. Each terminal
owns its own streams and mutable Ghostty state.

The runnable example is `packages/pizza/spikes/in-process.test.ts`:

```ts
await using terminal = await createTerminal();
await using ui = await createUI(terminal.appIO);
mountPizza(ui.host);
terminal.run(ui.main);

await terminal.keyboard.type('Ryan');
expect(await terminal.screen.findByText('Ryan')).toBeVisible();
```

`mountPizza` is the same application constructor used by the pizza CLI. It builds
the real forms, inputs, buttons, and dialog. The tests inspect Ghostty's terminal
cells and cursor after sending encoded input. They never dispatch UI events or
read field state directly.

The first test constructs a text element directly inside the test, without an
application module. This checkout exposes `ui.host`; it has no `ui.document` API.
The interactive journey opts into the existing semantic producer through a
UI-local extension and uses the existing Clack CSS locators and focus matchers.
It does not change process streams, environment variables, or extension registries.

## Run

Install workspace dependencies with `pnpm install --frozen-lockfile`. On a clean
checkout, build just the WASM artifact with Bun and Zig 0.15.2 on PATH:

```sh
pnpm --filter ghostwright fetch:ghostty
pnpm --filter ghostwright build:ghostty-vt
pnpm --filter @ghostwright/pizza test:in-process
pnpm --filter @ghostwright/pizza typecheck:in-process
```

The spike's Vitest configuration resolves Ghostwright to its source files. This
keeps the locator/inspection/matcher class identity consistent and avoids needing
a package build. The existing subprocess tests remain under `packages/pizza/test`
and run separately with `pnpm --filter @ghostwright/pizza test`.

## What it exercises

- Appending text through an injected output stream.
- The pizza journey: caret editing, delivery fields, modal focus wrapping,
  submission, restored focus, retained values, and resizing to 36 columns.
- Terminal query replies delivered asynchronously, and input buffered before
  the app starts reading.
- Independent applications and terminal engines in the same process.
- A thrown test error: pending queries cancel, the app's input loop ends, raw mode
  resets, listeners detach, and disposal can be repeated.

## Findings and boundaries

The connection is feasible without changing the Ghostwright subprocess API or
Clack UI implementation. This is experimental source, not a published export.

`createUI` currently separates rendering from input consumption. `terminal.run(ui.main)`
starts and owns that input loop. Terminal disposal sends EOF and awaits it, with a
one-second cleanup bound. Declare the UI after the terminal so UI restoration
bytes are written before Ghostty is freed. General JavaScript tasks cannot be
forcibly stopped if they ignore EOF.

`createUI` also requires concrete `node:tty` stream types. The adapter has one
explicit type assertion at this boundary: it implements the methods this UI
consumes, but has no real file descriptor or kernel line discipline. A production
version should define a minimal terminal I/O interface shared with `createUI`.

The spike implements keyboard input, query replies, resizing, immutable screen
queries, and waits. It does not yet provide the full session API: mouse actions,
capture, action receipts, history limits, trace artifacts, and production queue
backpressure still need integration. Process and signal assertions belong to the
PTY connection. Snapshot publication here is per ordinary output segment, which
can be finer than the OS read boundaries of a PTY connection.

A production implementation should extract the common screen/observation and
execution machinery from `TerminalSession` behind separate PTY and in-process
connections, then share lifecycle, capture, diagnostics, and limits. The spike
deliberately reuses the existing pure primitives without making that larger
refactor first.

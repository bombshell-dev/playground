# Ghostwright

Ghostwright blackbox-tests terminal CLIs and TUIs from the outside using a real Unix PTY and a dedicated upstream `libghostty-vt` WebAssembly instance. The application sees real TTY descriptors, raw/canonical input, dimensions, process-group signals, alternate screens, mouse modes, and terminal responses; it does not link Ghostwright or expose internals.

## Give Ghostwright to a coding agent

Install Ghostwright, then tell your agent:

> Read `node_modules/ghostwright/AGENTS.md`. Add outside-in blackbox tests for `<your command>`. Use the repository's existing test runner, visible terminal state only, no application instrumentation, and no fixed readiness sleeps. Run the focused tests and inspect Ghostwright artifacts before reporting failure.

Inside this repository:

> Read `experiments/ghostwright/AGENTS.md`, then blackbox test `<target command>` using Ghostwright's public API.

Start with the [agent quickstart](docs/agent-quickstart.md) or prove your agent can [exit vi](examples/async/agent-closes-vi.test.ts).

## Install

```sh
npm install --save-dev ghostwright
# or
bun add --dev ghostwright
```

Consumers receive prebuilt WASM, terminfo, and the native host for each supported target. No C compiler, Rust, Zig, or Ghostty installation is required.

## First async test

```ts
import { expect, test } from 'vitest';
import 'ghostwright/vitest';
import { launchTerminal } from 'ghostwright';

test('interactive CLI', async () => {
	await using terminal = await launchTerminal({
		command: 'node',
		args: ['src/cli.js'],
		viewport: { columns: 80, rows: 24 },
	});
	const { screen, keyboard } = terminal;

	expect(await screen.findByText('Ready')).toBeVisible();
	await keyboard.press('Enter');
	expect(await screen.findByText('Complete')).toBeVisible();
	expect((await terminal.process.waitForExit()).exitCode).toBe(0);
});
```

`launchTerminal` returns an owned execution scope. `await using` or `close()` cancels owned work and awaits PTY, sidecar, process-group, and WASM cleanup. Disposal is idempotent. Query results and locators are not disposable. TypeScript users need explicit-resource-management support in their compiler/runtime toolchain.

The callback form uses the same lifecycle:

```ts
import { withTerminal } from 'ghostwright';

await withTerminal(options, async ({ screen, keyboard }) => {
	await screen.findByText('Ready');
	await keyboard.press('Enter');
});
```

**Disposal cannot observe a test-body exception.** Bare `await using` guarantees cleanup, but does not automatically retain failure-only traces. Use `trace: 'on'`, `withTerminal`, or a runner fixture for that. A runner can also call `terminal.recordFailure(error)` explicitly.

With Vitest, the exported fixture owns launches and reports test failures before cleanup:

```ts
import { expect } from 'vitest';
import { test } from 'ghostwright/vitest';

test('CLI starts', async ({ launchTerminal }) => {
	const { screen } = await launchTerminal(options);
	expect(await screen.findByText('Ready')).toBeVisible();
});
```

For Jest, import `ghostwright/jest` to install the same immediate matchers. Use the callback helper for automatic failure artifacts. `ghostwright/matchers` exports `terminalMatchers` and `createRunnerMatchers(definitions)` for local `expect.extend(...)` integrations. Core imports do not load a test runner.

Effection users import `withTerminal` from `ghostwright/effection`; see the [Effection examples](examples/effection/).

## Scoped capture and semantic addressing

The new region API separates immutable locator queries, paired observations, terminal-evidence matchers, and scope-owned execution. Start with [Scoped observations and assertions](docs/scoped-execution.md). The pizza and pizza-preact tests demonstrate this API through real PTYs.

Descriptions provide identity and geometry, not proof of focus or value. Typed matcher extensions stay local. Async and Effection capture share one execution core.

The older text-locator and screen-history API below remains available during this experiment.

## Queries and waiting

A locator is a reusable recipe. A query returns frozen `RegionInspection` evidence from one observation. Later output does not change a previous query result.

| Query        | No matches | Multiple matches     | Waits |
| ------------ | ---------- | -------------------- | ----- |
| `getBy`      | Throws     | Throws               | No    |
| `queryBy`    | `null`     | Throws               | No    |
| `findBy`     | Retries    | Retries until unique | Yes   |
| `getAllBy`   | Throws     | Returns all          | No    |
| `queryAllBy` | `[]`       | Returns all          | No    |
| `findAllBy`  | Retries    | Returns all          | Yes   |

Each method accepts a locator recipe. The `ByText` forms construct a cell-aware text recipe and use the same engine. Text matching is literal and case-sensitive within one physical row. By default it finds substrings; `{ exact: true }` matches the whole row after trailing padding is removed. `BySelector` forms require an adapter-owned `selector` function in the launch options; core does not interpret CSS.

```ts
import { launchTerminal } from 'ghostwright';
import { clackTtyExtension, locator } from '@ghostwright/clack-tty';

await using terminal = await launchTerminal({
	...options,
	env: { ...options.env, CLACK_UI_SEMANTIC: '1' },
	extensions: [clackTtyExtension()],
	selector: locator,
});
const { screen, mouse, waitFor } = terminal;
const save = locator('button[label="save"]');

await screen.findBy(save); // Same behavior as findBySelector('button[label="save"]').
await mouse.click(save); // Resolve again before input; never reuse old query coordinates.
await waitFor(() => {
	expect(screen.getBySelector('text[label="status"]')).toContainText('Saved');
});
```

Runner matchers inspect immediately. `waitFor` starts an attempt without waiting for an interval, retries thrown/rejected assertions, and returns any successful value—including `false`. It awaits an async callback without overlapping attempts. Terminal observations prompt early retries; an interval covers changes that produce no terminal output. Process exit alone does not end a generic wait. Scope disposal or an explicit abort signal cancels it.

`waitFor` and `findBy` accept `{ timeoutMs, intervalMs, signal }`. The default timeout is the session's `assertionTimeoutMs` or 4000 ms. The default interval is 50 ms. Durations must be finite and between 0 and 2147483647 ms, the supported timer range. Text finders accept text and wait options in the same options object. Timeout errors retain the last assertion as their cause and include the current screen. Put input outside retry callbacks. Combine related assertions in one callback when they must describe a coherent state.

Described queries require a valid description paired with the current screen. An unavailable or invalid description throws—even for `queryBy` and `queryAllBy`. Unknown structure is not proof of absence. `findBy` and `waitFor` can wait for the next valid observation.

A successful query proves a match, not visibility, focus, or enabled state. Use the corresponding evidence matcher. `toBeVisible` requires viewport overlap and at least one cell without the invisible style; it does not assert terminal-window visibility or graphical occlusion. `null` is accepted by `.not.toBeVisible()`.

## Input targets

`mouse.move`, `hover`, `down`, `up`, `click`, and `doubleClick` accept coordinates or locator recipes. A locator action waits for one on-screen target and fails immediately on ambiguity. This differs deliberately from `findBy`, which retries ambiguity.

`mouse.drag(start, destination)` accepts a locator or point as its start, and either a point or `{ by: { columns, rows } }` as its destination. The start resolves once. The gesture does not chase a moving target, retry input, or enable application mouse reporting. Invalid destinations fail before button-down. Modifier options support Shift, Alt, and Control; standard mouse reports cannot encode Super/Command. `keyboard` and `mouse` send terminal input, not application events.

## Lower-level assertion helpers

The `expectTerminal` helpers below remain revision-driven:

| Intent                                | API                 |
| ------------------------------------- | ------------------- |
| First visible appearance / readiness  | `toBePresent()`     |
| Final visually settled state          | `toBeStable()`      |
| Stable disappearance                  | `toBeAbsent()`      |
| Text is drawn with a given style      | `toHaveStyle()`     |
| The cursor sits on the match          | `toContainCursor()` |
| Compound stable screen condition      | `toSatisfy()`       |
| Fleeting screen state after an action | `toHaveShown()`     |
| Fleeting text after an action         | `toHaveShownText()` |

Text locators are lazy, current-visible-viewport only, grapheme-aware, and strict. Zero matches wait; multiple matches fail with candidate geometry. Use `.nth()`, `.region()`, or a `style` filter to disambiguate deliberately.

Assertions default to `DEFAULT_ASSERTION_TIMEOUT_MS` (4000 ms), deliberately below the 5000 ms default of Bun, Jest, and Vitest. If they were equal the runner's own timeout would win the race and report a bare "timed out" instead of Ghostwright's screen diagnostic. Raise it per assertion with `{ timeoutMs }`, or for a session with `assertionTimeoutMs`.

## Inspecting styles, cursor, and cells

Focus, selection, and error states in a TUI are usually expressed visually rather than as text. Locators can filter and assert on style:

```ts
// Assert how something is drawn.
await expectTerminal(terminal.getByText('Save')).toHaveStyle({ foreground: '#ffffff' });

// Disambiguate identical text by appearance.
const active = terminal.getByText('Save', { style: { inverse: true } });

// Assert where the caret is.
await expectTerminal(terminal.getByText('Name')).toContainCursor();
```

Colours accept `'#rrggbb'`, `'rgb(r,g,b)'`, `'default'`, `'palette:N'`, or the structured `TerminalColor`. Any omitted `StyleQuery` field is ignored.

For geometry and raw cells, `matches()` returns each hit's `range` and backing `cells`, and `screen.getCells(rect)` returns a rectangle:

```ts
const [match] = terminal.getByText('Name').matches();
match.range; // { column, row, width, height }
match.cells; // ScreenCell[], each with .style

const border = terminal.screen.getCells({ column: 4, row: 7, width: 40, height: 3 });
import { cellsMatchStyle } from 'ghostwright';
cellsMatchStyle(border, { foreground: '#ffffff' });
```

`screen.snapshot()` is an alias of `screen.current()`, matching `AsyncRegion.snapshot()`.

See [Choosing locators and assertions](docs/choosing-assertions.md).

## Historical and graphics inspection

Retained revision ranges use an explicit exclusive baseline, so animation tests can inspect the PTY-observed trajectory without claiming every application timer write was presented:

```ts
const samples = terminal.screen.revisions({ since: action });
const collection = await terminal.revisions.collect({
	since: action,
	until: (snapshot) => snapshot.lines.some((line) => line.text.includes('Complete')),
});
```

Terminal scrollback is a serialized, bounded observation of Ghostty history; it does not search application-owned virtual history. Pages default to 200 rows (maximum 1,000), and generation guards prevent mixed pagination after output or reflow:

```ts
const page = await terminal.history.read({ count: 200 });
const matches = await terminal.history.findText('tool completed', { direction: 'newest-first' });
```

`ScreenSnapshot.graphics` exposes active-screen renderer-ready Kitty placement/image metadata. The shipped deterministic profile accepts bounded direct raw RGB/RGBA/gray transfers (64 MiB per screen by default), hashes decoded pixels, and rejects file/shared-memory media. PNG transport/playback support is not enabled in this artifact. Graphics inspection proves Ghostty accepted and prepared image data for rendering; it does not prove font/GPU-composited pixels.

## Documentation

- [Agent operational guide](AGENTS.md)
- [Agent quickstart](docs/agent-quickstart.md)
- [Choosing locators and assertions](docs/choosing-assertions.md)
- [Interaction recipes](docs/interaction-recipes.md)
- [Debugging failures and traces](docs/debugging-failures.md)
- [Architecture](docs/architecture.md)
- [Runnable async and Effection examples](examples/)
- [C versus Rust PTY-host comparison](HOST-COMPARISON.md)
- [Performance report](PERFORMANCE.md)

## Compatibility

- Node 22+
- Bun 1.2+
- Deno 2.2+
- macOS and Linux
- arm64 and x64

Deno requires path-scoped read/run permissions for package artifacts and `--allow-env` for environment inheritance. Permission errors print the exact paths to grant.

The deterministic profile uses `TERM=xterm-ghostty`, package-local terminfo, truecolor, Ghostwright program identity, a dark color scheme, 10×20 pixel cells, an 80×24 default viewport, and 10,000 rows of maximum scrollback. Explicit terminal-identity environment overrides are rejected.

## Fidelity boundary

A sidecar output frame is one OS PTY read, not a pixel-rendered frame. The kernel may combine application writes. Ghostwright does not create per-byte revisions. Registered OSC boundaries can split one read into coherent description/screen observations. Without such boundaries, it cannot recover a state overwritten within one kernel-coalesced read.

Ghostwright validates terminal-grid and PTY behavior. It does not validate fonts, shaping, rasterization, GPU output, or graphical occlusion.

## Security

Ghostwright is **not a sandbox**. Commands run directly, without an implicit shell, using the caller's filesystem, network, process, and credential permissions. Launch a shell explicitly only when shell syntax is intended.

Failure tracing defaults to `retain-on-failure` when the callback helper or runner fixture reports a failure. Bare async disposal cannot detect the test outcome. Common secret-like environment keys are redacted, and typed/pasted input can use `{ trace: "redact" }`, but application output and unmarked values may still contain secrets. Use `trace: "off"` for sensitive sessions.

## Maintainer artifacts

Generated `dist/`, `artifacts/`, Rust `target/`, and candidate host binaries are Git-ignored and assembled before packaging.

Working on Ghostwright itself (as opposed to consuming it) requires building those artifacts once from a clean clone:

```sh
bun run setup
```

That fetches the pinned Ghostty source, builds `ghostty-vt.wasm` and the native PTY host, compiles terminfo, refreshes checksums, and verifies the result. It needs the exact Zig version recorded in `ghostty.lock.json` (currently 0.15.2) on `PATH`; Rust/Cargo and the platform linker are also required for the native host. Consumers do not need these tools. The command is idempotent and safe to re-run.

Then run the tests:

```sh
pnpm test
```

This runs the Bun suite and real Jest/Vitest matcher and failure-artifact contracts. `bun test examples` runs only the application examples.

`ghostty.lock.json` is the source of truth for the build contract and is edited by hand. `bun run update:manifest` only refreshes the `artifacts` checksum map, and only for targets built on the current machine; entries for targets built elsewhere (for example the Linux hosts when building on macOS) are preserved. `bun run verify:artifacts` skips and reports artifacts that are absent locally, and fails hard on any artifact that is present but does not match.

The sole PTY host is `native/pty-host-rust`. It uses `nix`, `minicbor`, and `thiserror`, without Tokio. The host owns only POSIX processes, PTYs, byte queues, and control messages.

```sh
bun run build:host:rust
bun run test:host
bun run typecheck
```

Set `GHOSTWRIGHT_RUST_TARGET` to select a Rust target. Release builds need the matching linker and standard library. This rewrite has been built and tested locally only on macOS arm64; Linux and macOS x64 artifacts still need release-runner validation.

[`HOST-COMPARISON.md`](HOST-COMPARISON.md) is a historical report. Zig remains pinned for upstream Ghostty WASM.

Release jobs build native targets on matching runners, compile tracked terminfo, generate package output, and record checksums. `bun run verify:artifacts` independently checks hashes, protocol markers, WASM exports, and ABI layouts without rebuilding.

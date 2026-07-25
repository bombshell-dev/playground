# Ghostwright

Ghostwright blackbox-tests terminal CLIs and TUIs from the outside using a real Unix PTY and a dedicated upstream `libghostty-vt` WebAssembly instance. The application sees real TTY descriptors, raw/canonical input, dimensions, process-group signals, alternate screens, mouse modes, and terminal responses; it does not link Ghostwright or expose internals.

## Give Ghostwright to a coding agent

Install Ghostwright, then tell your agent:

> Read `node_modules/ghostwright/AGENTS.md`. Add outside-in blackbox tests for `<your command>`. Use the repository's existing test runner, visible terminal state only, no application instrumentation, and no fixed readiness sleeps. Run the focused tests and inspect Ghostwright artifacts before reporting failure.

Inside this repository:

> Read `packages/ghostwright/AGENTS.md`, then blackbox test `<target command>` using Ghostwright's public API.

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
import { expect, test } from 'bun:test';
import { expectTerminal, withTerminalAsync } from 'ghostwright';

test('interactive CLI', async () => {
	await withTerminalAsync(
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

The callback owns the terminal. Normal return, throw, assertion failure, and cancellation close the PTY, sidecar, application process group, and WASM resources before the outer operation completes.

Effection users get the same operations and lifecycle through `withTerminal`; see the [Effection examples](examples/effection/).

## Synchronization model

Ghostwright assertions are revision-driven rather than polling-based:

| Intent                                | API                 |
| ------------------------------------- | ------------------- |
| First visible appearance / readiness  | `toBePresent()`     |
| Final visually settled state          | `toBeStable()`      |
| Stable disappearance                  | `toBeAbsent()`      |
| Compound stable screen condition      | `toSatisfy()`       |
| Fleeting screen state after an action | `toHaveShown()`     |
| Fleeting text after an action         | `toHaveShownText()` |

Text locators are lazy, current-visible-viewport only, grapheme-aware, and strict. Zero matches wait; multiple matches fail with candidate geometry. Use `.nth()` or `.region()` to disambiguate deliberately.

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

A sidecar output frame is one OS PTY read, not a pixel-rendered frame. The kernel may combine application writes. Ghostwright never splits a read into artificial per-byte revisions and never coalesces separate host frames, but it cannot recover a state overwritten within one kernel-coalesced read.

Ghostwright validates terminal-grid and PTY behavior. It does not validate fonts, shaping, rasterization, GPU output, or graphical occlusion.

## Security

Ghostwright is **not a sandbox**. Commands run directly, without an implicit shell, using the caller's filesystem, network, process, and credential permissions. Launch a shell explicitly only when shell syntax is intended.

Failure tracing defaults to `retain-on-failure`. Common secret-like environment keys are redacted, and typed/pasted input can use `{ trace: "redact" }`, but application output and unmarked values may still contain secrets. Use `trace: "off"` for sensitive sessions.

## Maintainer artifacts

Generated `dist/`, `artifacts/`, Rust `target/`, and candidate host binaries are Git-ignored and assembled before packaging.

The PTY host has two side-by-side implementations:

- `native/pty-host-c`: packaged pure-C default, compiled with Apple Clang or native `musl-gcc`
- `native/pty-host-rust`: synchronous Rust candidate using `nix`, `minicbor`, and `thiserror`

```sh
bun run build:host:c
bun run build:host:rust
bun run test:hosts
bun run compare:hosts
```

See [`HOST-COMPARISON.md`](HOST-COMPARISON.md). Zig remains pinned only because upstream Ghostty uses it to build `ghostty-vt.wasm`; the PTY host has no Zig wrapper or `zig cc` dependency.

Release jobs build native targets on matching runners, compile tracked terminfo, generate package output, and record checksums. `bun run verify:artifacts` independently checks hashes, protocol markers, WASM exports, and ABI layouts without rebuilding.

# Ghostwright

Ghostwright drives terminal programs from the outside through a real Unix PTY and a dedicated upstream `libghostty-vt` WebAssembly instance.

```ts
import { expectTerminal, withTerminalAsync } from "ghostwright";

await withTerminalAsync({ command: "bun", args: ["app.ts"] }, async (terminal) => {
  await expectTerminal(terminal.getByText("Ready")).toBeStable();
  await terminal.keyboard.press("Enter");
});
```

The callback is the ownership scope: return, throw, or cancellation closes the terminal and its process group. Generator users can use `withTerminal` with Effection 4 operations.

## Compatibility

- Node 22+
- Bun 1.2+
- Deno 2.2+ with `--allow-read=<package-artifacts> --allow-run=<pty-host> --allow-env` (environment inheritance requires the final permission)
- macOS/Linux on arm64/x64

`TERM=xterm-ghostty`, package-local terminfo, truecolor, 10×20 pixel cells, and 10,000 scrollback rows form one deterministic profile. Explicit terminal-identity environment overrides are rejected.

A sidecar output frame is one OS PTY read, not a pixel-rendered frame. The kernel may combine application writes; Ghostwright never splits a read into synthetic intermediate revisions or coalesces separate sidecar output frames.

## Security

Ghostwright is **not a sandbox**. Commands run directly without an implicit shell and retain the caller's filesystem, network, process, and credential permissions. Launch a shell explicitly if shell syntax is required.

Failure tracing defaults to `retain-on-failure`. Application output can contain secrets even when environment and marked input values are redacted. Use `trace: "off"` for sensitive sessions.

## Maintainer artifacts

Consumers never build native code. Generated `dist/`, `artifacts/`, Rust `target/`, and candidate host binaries are Git-ignored and assembled before packaging.

The PTY host has two side-by-side implementations under `native/pty-host-c` and `native/pty-host-rust`. The packaged default is pure C compiled with Apple Clang on macOS or native `musl-gcc` on Linux—no Zig wrapper or `zig cc`. The Rust candidate uses `nix`, `minicbor`, and `thiserror` with a synchronous event loop. Build and compare them with:

```sh
bun run build:host:c
bun run build:host:rust
bun run test:hosts
bun run compare:hosts
```

See [`HOST-COMPARISON.md`](HOST-COMPARISON.md) for measured results. Zig remains pinned only because upstream Ghostty uses it to build `ghostty-vt.wasm`. Release CI builds each native target on its matching OS/architecture runner, combines the generated artifacts, compiles the tracked terminfo source, and regenerates checksums. `bun run verify:artifacts` independently checks hashes, the GWPT protocol marker, required WASM exports, and ABI layouts.

# Architecture

Ghostwright combines two things a pipe-backed terminal harness cannot provide:

1. A real Unix pseudoterminal for kernel TTY and process semantics
2. Ghostty's production VT engine for terminal protocol and screen semantics

```text
Test runner / coding agent
          │
          ▼
Ghostwright public API
  ├── scoped async / Effection lifecycle
  ├── actions and action receipts
  ├── locators and assertions
  ├── snapshots and revisions
  └── traces and diagnostics
          │
          ├──────────────────────────────┐
          ▼                              ▼
libghostty-vt WASM                 native PTY host
  ├── VT parser                      ├── openpty
  ├── primary/alternate screen       ├── fork + exec
  ├── cells, styles, cursor           ├── session + controlling TTY
  ├── terminal modes                  ├── process group
  ├── key/mouse/paste encoders        ├── resize + signals
  └── terminal effects                └── wait, drain, cleanup
          ▲                              │
          └──── ordered PTY bytes ◄──────┘
                                             │
                                             ▼
                                      application under test
```

The application does not link Ghostwright or expose framework internals. It sees terminal file descriptors, line discipline, dimensions, signals, and input bytes.

## Responsibility boundary

### Native PTY host

The host performs only OS-facing work that `wasm32-freestanding` cannot perform:

- Create the PTY master/slave
- Create a session and controlling terminal
- Establish the application process group
- Execute a command and argument array
- Forward opaque PTY bytes
- Apply `TIOCSWINSZ`
- Send administrative signals
- Report direct-child exit separately from PTY EOF
- Drain output and terminate owned descendants
- Reap the child and acknowledge cleanup

It does not parse VT sequences, maintain cells, encode input, or evaluate assertions.

Two implementations are maintained side by side:

- `native/pty-host-c`: packaged default, pure C compiled with Clang or `musl-gcc`
- `native/pty-host-rust`: synchronous Rust candidate using `nix`, `minicbor`, and `thiserror`

Both implement the same protocol and pass the same host/full Ghostwright contract. See [`../HOST-COMPARISON.md`](../HOST-COMPARISON.md).

### Ghostty WASM

Every session owns a separate `WebAssembly.Instance` and Ghostty terminal handle. The immutable compiled `WebAssembly.Module` may be cached, but mutable terminal state is never shared.

Ghostty is the sole authority for:

- Parsing application output
- Primary and alternate buffers
- Cursor and modes
- Graphemes, wide cells, styles, selection, and hyperlinks
- Key, focus, mouse, and paste encoding
- Terminal query responses and effects

JavaScript does not maintain a second CSI/OSC parser.

## Session resource tree

```text
withTerminal / withTerminalAsync scope
├── Ghostty WASM instance
├── render state and input encoders
├── PTY-host subprocess
│   └── application process group
├── framed command writer
├── sidecar event reader
├── output → Ghostty pump
├── effect → PTY command queue
├── revision/history publisher
├── process/EOF watcher
└── trace sink
```

Leaving the callback normally, throwing, or cancelling enters the same idempotent cleanup path. Operations after closure fail rather than reviving resources.

## Sidecar protocol

JavaScript and the PTY host communicate over host stdin/stdout using the versioned GWPT binary protocol. Host stderr is crash diagnostics only.

A 20-byte little-endian header contains:

- Magic `GWPT`
- Protocol version
- Frame kind
- Sender-local sequence
- Correlation sequence
- Payload length

Control messages use deterministic CBOR. PTY `WRITE` and `OUTPUT` payloads remain raw bytes. Limits are enforced before allocation/action.

Commands include handshake, spawn, write, resize, signal, and close. Events include output, process exit, PTY EOF, acknowledgement, and structured error.

The spawn barrier establishes and reports trusted PID/process-group information before application code can create descendants. Exec confirmation completes the public spawn operation.

## Output and effects

For each PTY-host output frame:

1. Record raw offset and frame sequence.
2. Write the complete frame once to the session's Ghostty instance.
3. Copy synchronous terminal effects out of callbacks.
4. Extract the Ghostty render grid and evaluate one revision boundary.
5. Publish an immutable revision if observable state changed.
6. Drain terminal effects in callback order.
7. Serialize PTY-response writes with user actions.

Ghostty callbacks never re-enter terminal write.

Configured effects include PTY response, bell, title, working directory, enquiry, XTVERSION, size, color scheme, device attributes, and isolated clipboard writes.

## Snapshots and revisions

The initial snapshot has sequence zero. Observable output, resize, and reset changes produce monotonic `ScreenRevision` records containing:

- Cause and source frame
- Monotonic timestamp
- Changed rows
- Visual-change flag
- Immutable resulting snapshot

Adjacent revisions structurally reuse unchanged rows. History and raw output are bounded and oldest data is evicted explicitly.

Visual convergence compares visible cells/styles, cursor, active buffer, and viewport. Nonvisual effects do not restart settlement.

## PTY read boundaries

The PTY host emits one output frame for each successful OS read, up to 64 KiB. JavaScript processes frames serially and does not debounce or coalesce them.

The kernel may combine application writes before the host reads. Ghostwright cannot recover a state overwritten inside one kernel-coalesced read and does not manufacture per-byte/parser-action revisions. A revision is a terminal-state boundary, not a claim that a user saw a separate pixel-rendered frame.

## Process lifecycle

Direct-child exit and PTY EOF are distinct. Ghostwright continues processing output after direct exit. If a descendant retains the PTY beyond the drain deadline, it is treated as session-owned and terminated without replacing the direct child's original exit result.

Cleanup stages are:

1. PTY hangup / `SIGHUP` grace
2. `SIGTERM` grace
3. `SIGKILL` if still alive
4. Direct-child reap
5. Channel and WASM resource release

A wedged host-command timeout force-terminates the sidecar and attempts a validated process-group fallback from JavaScript.

## Deterministic profile

Sessions use:

- `TERM=xterm-ghostty`
- Package-local compiled terminfo
- `COLORTERM=truecolor`
- `TERM_PROGRAM=ghostwright`
- Package version identity
- Dark color scheme
- 10×20 pixel cells
- 80×24 default viewport
- 10,000 rows maximum scrollback

Explicit overrides of profile-owned environment keys are rejected. Other explicit environment values overlay inherited values.

## Generated artifacts

`dist/`, `artifacts/`, native candidate outputs, and Rust `target/` are generated and Git-ignored. Release jobs build them before packing. Consumers receive prebuilt WASM, terminfo, and four native hosts and do not need native toolchains.

Zig is required only to build upstream Ghostty WASM. The pure-C PTY host does not use a Zig wrapper or `zig cc`.

Artifact metadata pins source commit, toolchains, build flags, protocol/binding versions, ABI layouts, and checksums. Independent verification checks files without rebuilding them.

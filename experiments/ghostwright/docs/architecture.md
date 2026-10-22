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

`native/pty-host-rust` is the sole implementation. It uses `nix`, `minicbor`, and `thiserror`, without Tokio. Nonblocking queues keep control commands responsive when a child stops reading or a client stops consuming output. Rust ownership includes a process-killing fallback when protocol failure prevents normal cleanup.

### Ghostty WASM

Every session owns a separate `WebAssembly.Instance` and Ghostty terminal handle. The immutable compiled `WebAssembly.Module` may be cached, but mutable terminal state is never shared.

Ghostty is the sole authority for:

- Parsing application output
- Primary and alternate buffers
- Cursor and modes
- Graphemes, wide cells, styles, selection, and hyperlinks
- Key, focus, mouse, and paste encoding
- Terminal query responses and effects

JavaScript does not interpret terminal control sequences. It extracts only registered description OSC messages before forwarding ordinary bytes to Ghostty.

## Backend boundary

`CreateBackend` is `(options: BackendOptions) => Operation<TerminalBackend>`.
The default `createGhosttyBackend` acquires the existing Ghostty WASM engine as
an Effection resource and releases it with its scope, including late acquisition
and initialization failure. Its returned functions close over that instance and
reject use after release. The async session bridge owns a child scope, inheriting
the Effection caller when present, and explicitly closes it after transport drain.
The factory is explicit per session; there is no global backend registry.

`write` and `resize` return one `BackendUpdate`: a detached screen snapshot and
terminal effects. These operations, input encoding, and reads cannot suspend.
That keeps each ordinary byte segment and its resulting screen atomic relative
to registered OSC boundaries. Effects are values; session-owned queues deliver
PTY responses without blocking parsing. Session clocks and revision numbering
remain above the emulator boundary.

Live PTY sessions, local appIO sessions and replay consume the same contract.
The backend owns VT semantics; the shared output pipeline owns metadata pairing
and freshness. Replay consumes snapshots but does not deliver terminal effects.
Trace identity checks reject a different emulator/version before processing
recorded output. Existing Ghostty traces retain their artifact hash check.

## Session resource tree

```text
launchTerminal / withTerminal scope
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

Commands include handshake, spawn, write, cancel-write, resize, signal, and close. Events include output, process exit, PTY EOF, acknowledgement, and structured error.

The spawn barrier establishes and reports trusted PID/process-group information before application code can create descendants. Exec confirmation completes the public spawn operation.

The host bounds queued PTY input at 4 MiB / 1,024 writes and protocol output at 8 MiB. It pauses PTY reads above 4 MiB of queued protocol output. Close and cancel-write commands can overtake blocked PTY input. Input completion acknowledges bytes accepted by the PTY, not application processing. Interrupted native writes report `GW_WRITE_INTERRUPTED` and their partial `bytesWritten` count. Cancellation removes only the unwritten remainder. Client disappearance triggers process cleanup; final protocol flushing has a one-second bound.

## Output and effects

For each PTY-host output frame:

1. Record raw offset and frame sequence.
2. Split ordinary bytes and registered description OSC messages in stream order.
3. Write each ordinary segment once to Ghostty and publish its screen observation.
4. Decode each description with a pure extension decoder.
5. Validate its frame sequence and pair it with the preceding immutable screen.
6. Copy synchronous terminal effects out of callbacks.
7. Queue PTY responses with user actions without blocking output parsing.

Live sessions and replay share this pipeline. See [Scoped observations and assertions](scoped-execution.md) for the query, matcher, and capture layers.

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

The kernel may combine application writes before the host reads. Without a registered description boundary, Ghostwright cannot recover a state overwritten inside one kernel-coalesced read. It does not manufacture per-byte/parser-action revisions. A revision is a terminal-state boundary, not a claim that a user saw a separate pixel-rendered frame.

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

`dist/`, `artifacts/`, native candidate outputs, and Rust `target/` are generated and Git-ignored. Release jobs build them before packing. Consumers receive prebuilt WASM, terminfo, and native hosts and do not need native toolchains. This rewrite has only been built and tested locally on macOS arm64; the other target artifacts still need release validation.

Maintainers use pinned Zig for upstream Ghostty WASM and Cargo plus the target linker for the Rust host.

Artifact metadata pins source commit, toolchains, build flags, protocol/binding versions, ABI layouts, and checksums. Independent verification checks files without rebuilding them.

## Operation composition

Keyboard execution has an explicit capability boundary in `src/operations.ts`.
`KeyboardOperations` is the port contract. `createKeyboardOperations` accepts a
driver and an ordered list of typed middleware; callers receive the composed
facade. Each middleware receives the original argument tuple and a `next`
continuation with the same result type. The first entry is outermost.

The session adapter implements this contract using the existing PTY action
machinery. Encoding, command serialization, action receipts, and shutdown guards
remain in the session. Middleware can surround an operation's execution and
cleanup, but the raw driver is not exposed by the resulting execution capability.
Middleware is trusted application code: forwarding twice performs two actions;
there is no implicit retry or exactly-once enforcement.

`TerminalProgram<T>` is a function from `ExecutionOperations` to `Operation<T>`.
`AsyncExecution.run` executes a program in its owned scope; the Effection
facade's `run` invokes the same program in the caller's current scope. Both use
the same composed keyboard operations. Native keyboard calls no longer travel
through the Promise facade, so middleware can resolve the caller's Effection
context. The driver combines current-operation cancellation with owner
cancellation, including interruption of blocked PTY writes.

`captureProgram(options, body)` wraps a continuation with the existing capture
kernel. Recording subscribes before the body starts; completion still requires
both the condition and the body, and the deadline bounds both. Capture-local
keyboard middleware is appended inside inherited middleware and passed to nested
captures. It does not modify the parent. Escaped child capabilities reject calls
after the capture closes, and cleanup registered with `ensure` completes before cancellation
returns. The existing callback capture APIs use the same inheritance rules.

This first boundary covers keyboard operations and capture programs. Mouse,
process, query, and graphics APIs retain their existing adapters. Driver injection
is explicit; no scope-global port registry or experimental Effection API is needed.

## Scope ownership and cancellation

Native `withTerminal` creates an explicit `scoped` boundary. Delegating to a
resource with `yield*` alone shares the caller's scope; it does not delimit the
session lifetime. On success, failure, or halt, the session now drains and closes
before control returns to the outer operation. `useSession` remains a lower-level
resource whose lifetime intentionally belongs to the acquiring scope.

| Boundary                                                           | Context and lifetime                                                                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native keyboard operation / program                                | Child of the invoking scope; inherits current context and also observes terminal-owner cancellation.                                                                  |
| Native Promise facade (queries, mouse, process, history, graphics) | Creates an invocation-local executor, so its async tasks belong to the caller's subtree instead of being siblings under the terminal owner.                           |
| Async terminal methods                                             | Explicitly execute in the terminal/capture owner scope. A foreign Effection caller's context does not cross a Promise call automatically.                             |
| Capture                                                            | Owns observation subscriptions, timers, callback tasks, and child capabilities. Local middleware is an explicit inherited list, not a dynamic Effection API registry. |
| Backend scope                                                      | Explicit async bridge with an optional native parent for inherited context. The session keeps it alive through PTY output drain and explicitly awaits its release.    |

`useAbortSignal` is itself a resource. Its abortion follows cleanup registration
order, so cleanup must not assume that every signal is already aborted when it
starts. Native Promise bridges pass an invocation signal to actual cancellable
work. Cancelling only the Effection `call` would abandon the Promise while its
subscriptions, timers, or input remained active. Legacy assertions, locator
clicks, revision collection, and process-exit timeouts release their waits on
abort as well. Synchronous snapshots remain evidence values and do not acquire
new scopes.

Middleware functions and `composeOperation` do not capture a `Scope`. Explicit
owner binding exists only at the async facade; native invocation preserves the
caller's context. Concurrent callers can shadow context values without affecting
each other, and operation resources release before the action returns.

For asynchronous middleware release, use `yield* ensure(function* () { ... })`.
Effection 4.2 has characterized limitations around yielding `finally`: a halt
arriving while a finally block is already yielding can skip its remaining work,
and a yielding delegated finally can resume its caller after halt. Ghostwright
does not claim to repair arbitrary user generators. Its framework-owned resource
finalizers enter cleanup when their suspended resource is released; synchronous
capture unsubscribe/stop paths do not yield. The ownership tests gate `ensure`
cleanup and verify that repeated disposal and shutdown during an already-running
release wait for completion.

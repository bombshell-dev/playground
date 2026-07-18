# Ghostwright v1 performance report

Measured 2026-07-14 on macOS arm64, Bun 1.3.9, Node 22.21.1, with the bundled Darwin arm64 host and pinned `libghostty-vt` WASM. Run with:

```sh
bun packages/ghostwright/scripts/benchmark.ts
```

| Scenario | Iterations | Median | Range |
|---|---:|---:|---:|
| PTY launch, `/usr/bin/true` exit, and cleanup | 10 | 14.1 ms | 12.4–25.3 ms |
| 1 MiB unbroken PTY output into a 120×40 viewport | 5 | 31.1 s | 30.7–31.4 s |
| Migrated Solid blackbox selection (69 tests) | 1 | 69.7 s | single run |
| Prototype harness, same sources and 69 tests | 1 | 70.7 s | single run |

Initialization and ordinary interactive launch latency are practical. The deliberately adversarial 1 MiB burst is materially slow because Darwin commonly returns many small PTY reads; REQ-039 requires every read to remain a distinct Ghostty revision boundary, and each boundary currently extracts a complete immutable styled grid through the upstream C ABI. Ghostwright does not hide this by coalescing output frames.

The accepted optimization path is the marshal-only WASM bridge allowed by REQ-035: add one bulk render-snapshot export that batches upstream render-row/cell getters without adding terminal semantics. This is not required for correctness or the interactive Solid workload, but should be implemented before treating high-throughput transcript ingestion as a performance-sensitive use case. The benchmark remains a regression report rather than an absolute v1 SLA.

Side-by-side runs produce the same 53 passes and the same 16 layout/window failures with Ghostwright and the pre-migration prototype harness against the already-modified `packages/clayterm` submodule checkout. Those failures are therefore not Ghostwright synchronization regressions; all other migrated scenarios pass through a real PTY.

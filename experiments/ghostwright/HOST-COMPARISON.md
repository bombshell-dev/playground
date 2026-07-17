# PTY Host C vs. Rust Comparison

Generated on 2026-07-15T09:03:59.623Z by `bun run compare:hosts` on darwin-arm64.

Both candidates passed the same GWPT/PTY contract before measurement. Candidate outputs are generated under the ignored `.cache/hosts` directory and are not included in the npm artifact inventory.

| Implementation | Source files | Nonblank LOC | `unsafe` tokens | Stripped binary | Warm build | Median launch/exit | Raw 1 MiB transport |
|---|---:|---:|---:|---:|---:|---:|---:|
| Pure C | 5 | 1083 | 0 | 36.1 KiB | 710.9 ms | 18.6 ms | 36.1 MiB/s |
| Rust | 3 | 979 | 21 | 345.0 KiB | 57.4 ms | 19.8 ms | 38.3 MiB/s |

## Pure C

- Compiler: Apple Clang on macOS; native `musl-gcc` on Linux release runners.
- Runtime dependencies: system libc on Darwin; static musl on Linux.
- The protocol, ownership rules, and cleanup are explicit, but allocation and file-descriptor cleanup remain manual.
- No Zig code or Zig C compiler is used for the PTY host.

## Rust

- Direct dependencies: `nix`, `minicbor`, and `thiserror`.
- The event loop is synchronous; there is no Tokio or async runtime.
- Owned file descriptors provide automatic parent-side closure. Unsafe code is concentrated around the post-fork child setup and exact ioctl/exec operations.
- The larger binary includes Rust runtime and formatting/panic support despite LTO, aborting panics, and stripping.

## Notes

- “Warm build” includes an incremental Cargo build; a clean Rust build also compiles dependencies and is intentionally reported separately during release evaluation. On macOS the C build command emits both arm64 and x64 binaries while the measured Rust command emits the native binary, so this number is not a single-target compiler comparison.
- Raw transport bypasses Ghostty screen extraction, isolating sidecar throughput.
- Zig remains a maintainer dependency only for building upstream `ghostty-vt.wasm`; it is absent from both PTY-host implementations.

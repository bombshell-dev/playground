import { $ } from 'bun';

const root = new URL('..', import.meta.url).pathname,
	artifacts = `${root}/artifacts`;

// Rust owns only PTY/process transport. Zig is used separately for Ghostty WASM.
await $`bun ${root}/scripts/build-host-rust.ts`;
await $`rm -rf ${artifacts}/terminfo/67 ${artifacts}/terminfo/78`;
await $`tic -x -o ${artifacts}/terminfo ${root}/native/terminfo/xterm-ghostty.src`;
await $`bun ${root}/scripts/update-manifest.ts`;

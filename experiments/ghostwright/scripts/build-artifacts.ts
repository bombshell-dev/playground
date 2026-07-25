import { $ } from 'bun';

const root = new URL('..', import.meta.url).pathname,
	artifacts = `${root}/artifacts`;

// The packaged default remains the pure-C implementation while the Rust host
// is evaluated side by side. This script never invokes Zig for PTY-host code.
await $`bun ${root}/scripts/build-host-c.ts`;
await $`rm -rf ${artifacts}/terminfo/67 ${artifacts}/terminfo/78`;
await $`tic -x -o ${artifacts}/terminfo ${root}/native/terminfo/xterm-ghostty.src`;
await $`bun ${root}/scripts/update-manifest.ts`;

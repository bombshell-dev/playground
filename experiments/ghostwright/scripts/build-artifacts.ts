import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname,
	artifacts = `${root}/artifacts`;

// Rust owns only PTY/process transport. Zig is used separately for Ghostty WASM.
await $`bun ${root}/scripts/build-host-rust.ts`;
await $`rm -rf ${artifacts}/terminfo/67 ${artifacts}/terminfo/78 ${artifacts}/terminfo/g ${artifacts}/terminfo/x`;
await $`tic -x -o ${artifacts}/terminfo ${root}/native/terminfo/xterm-ghostty.src`;
// ncurses uses character directories on Linux and hexadecimal directories on
// macOS. Keep the package's canonical paths available on both hosts.
for (const [character, hexadecimal, name] of [
	['g', '67', 'ghostty'],
	['x', '78', 'xterm-ghostty'],
]) {
	const source = `${artifacts}/terminfo/${character}/${name}`;
	if (existsSync(source)) {
		await mkdir(`${artifacts}/terminfo/${hexadecimal}`, { recursive: true });
		await copyFile(source, `${artifacts}/terminfo/${hexadecimal}/${name}`);
	}
}
await $`bun ${root}/scripts/update-manifest.ts`;

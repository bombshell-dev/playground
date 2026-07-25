import { $ } from 'bun';
import { mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname,
	crate = `${root}/native/pty-host-rust`,
	cache = `${root}/.cache/hosts`,
	target = process.env.GHOSTWRIGHT_RUST_TARGET;
await mkdir(cache, { recursive: true });

if (target) {
	await $`cargo build --release --locked --target ${target}`.cwd(crate);
	await $`cp ${crate}/target/${target}/release/ghostwright-pty-host ${cache}/pty-host-rust`;
} else {
	await $`cargo build --release --locked`.cwd(crate);
	await $`cp ${crate}/target/release/ghostwright-pty-host ${cache}/pty-host-rust`;
}
await $`chmod +x ${cache}/pty-host-rust`;
// oxlint-disable-next-line no-console -- build script
console.log(`${cache}/pty-host-rust`);

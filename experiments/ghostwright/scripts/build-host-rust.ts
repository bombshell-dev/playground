import { $ } from 'bun';
import { UnsupportedPlatformError } from '../src/errors.ts';
import { copyFile, mkdir, chmod } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
const crate = `${root}/native/pty-host-rust`;
const targets: Record<string, string> = {
	'aarch64-apple-darwin': 'darwin-arm64',
	'x86_64-apple-darwin': 'darwin-x64',
	'aarch64-unknown-linux-musl': 'linux-arm64',
	'x86_64-unknown-linux-musl': 'linux-x64',
};
const local = `${process.platform}-${process.arch}`;
const target =
	process.env.GHOSTWRIGHT_RUST_TARGET ??
	Object.keys(targets).find((candidate) => targets[candidate] === local);
if (!target || !targets[target])
	throw new UnsupportedPlatformError(`Unsupported Rust PTY target: ${target ?? local}`);
await mkdir(`${root}/artifacts`, { recursive: true });
await mkdir(`${root}/.cache/hosts`, { recursive: true });
await $`cargo build --release --locked --target ${target}`.cwd(crate);
const binary = `${crate}/target/${target}/release/ghostwright-pty-host`;
const output = `${root}/artifacts/pty-host-${targets[target]}`;
await copyFile(binary, output);
await chmod(output, 0o755);
if (targets[target] === local) await copyFile(output, `${root}/.cache/hosts/pty-host-rust`);
console.info(output);

import { $ } from 'bun';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname,
	source = `${root}/.cache/ghostty`,
	lock = JSON.parse(await readFile(`${root}/ghostty.lock.json`, 'utf8')),
	zig = (await $`zig version`.text()).trim();
if (zig !== lock.zigVersion)
	throw new Error(`Ghostwright artifact build requires Zig ${lock.zigVersion}, found ${zig}`);
const patch = `${root}/patches/0001-freestanding-kitty-direct-only.patch`;
await $`git -C ${source} reset --hard ${lock.ghostty.commit}`;
await $`git -C ${source} apply --check ${patch}`;
await $`git -C ${source} apply ${patch}`;
const patchSha256 = createHash('sha256')
	.update(await readFile(patch))
	.digest('hex');
if (lock.graphics?.freestandingPatchSha256 !== patchSha256)
	throw new Error('Ghostwright freestanding Kitty patch checksum mismatch');
await $`cd ${source} && zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall`;
await $`cp ${source}/zig-out/bin/ghostty-vt.wasm ${root}/artifacts/ghostty-vt.wasm`;

import { $ } from 'bun';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { GhostwrightError } from '../src/errors.ts';

const root = new URL('..', import.meta.url).pathname,
	source = `${root}/.cache/ghostty`,
	lock = JSON.parse(await readFile(`${root}/ghostty.lock.json`, 'utf8'));
if (!existsSync(source))
	throw new GhostwrightError({
		code: 'GW_GHOSTTY_SOURCE',
		message: `Ghostty source checkout missing at ${source}; run \`bun run fetch:ghostty\` first (or \`bun run setup\` to do everything)`,
	});
let zig: string;
try {
	zig = (await $`zig version`.text()).trim();
} catch {
	throw new GhostwrightError({
		code: 'GW_ZIG_MISSING',
		message: `Ghostwright artifact build requires Zig ${lock.zigVersion} on PATH, but \`zig\` was not found`,
	});
}
if (zig !== lock.zigVersion)
	throw new GhostwrightError({
		code: 'GW_ZIG_VERSION',
		message: `Ghostwright artifact build requires Zig ${lock.zigVersion}, found ${zig}`,
	});
const patch = `${root}/patches/0001-freestanding-kitty-direct-only.patch`;
await $`git -C ${source} reset --hard ${lock.ghostty.commit}`;
await $`git -C ${source} apply --check ${patch}`;
await $`git -C ${source} apply ${patch}`;
const patchSha256 = createHash('sha256')
	.update(await readFile(patch))
	.digest('hex');
if (lock.graphics?.freestandingPatchSha256 !== patchSha256)
	throw new GhostwrightError({
		code: 'GW_PATCH_CHECKSUM',
		message: 'Ghostwright freestanding Kitty patch checksum mismatch',
	});
await $`cd ${source} && zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall`;
// artifacts/ is gitignored, so it does not exist in a clean clone.
await $`mkdir -p ${root}/artifacts`;
await $`cp ${source}/zig-out/bin/ghostty-vt.wasm ${root}/artifacts/ghostty-vt.wasm`;

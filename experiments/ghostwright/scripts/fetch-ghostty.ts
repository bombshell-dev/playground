import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname,
	cache = `${root}/.cache/ghostty`,
	lock = JSON.parse(await readFile(`${root}/ghostty.lock.json`, 'utf8'));
await mkdir(`${root}/.cache`, { recursive: true });
if (!existsSync(`${cache}/.git`))
	await $`git clone --filter=blob:none ${lock.ghostty.repository} ${cache}`;
await $`git -C ${cache} fetch --depth=1 origin ${lock.ghostty.commit}`;
await $`git -C ${cache} checkout --detach ${lock.ghostty.commit}`;
const actual = (await $`git -C ${cache} rev-parse HEAD`.text()).trim();
if (actual !== lock.ghostty.commit)
	throw new Error(`Ghostty checkout mismatch: expected ${lock.ghostty.commit}, got ${actual}`);

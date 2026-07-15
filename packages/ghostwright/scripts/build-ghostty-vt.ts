import { $ } from "bun";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url).pathname,
  source = `${root}/.cache/ghostty`,
  lock = JSON.parse(await readFile(`${root}/ghostty.lock.json`, "utf8")),
  zig = (await $`zig version`.text()).trim();
if (zig !== lock.zigVersion)
  throw new Error(`Ghostwright artifact build requires Zig ${lock.zigVersion}, found ${zig}`);
await $`cd ${source} && zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall`;
await $`cp ${source}/zig-out/bin/ghostty-vt.wasm ${root}/artifacts/ghostty-vt.wasm`;

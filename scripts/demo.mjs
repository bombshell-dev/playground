import { spawnSync } from "node:child_process";

const name = process.argv[2];
if (!name) {
  console.error("usage: pnpm demo <name>   (e.g. pnpm demo freedom-focus-text-input)");
  process.exit(1);
}

const { status } = spawnSync(
  "node",
  ["--experimental-transform-types", "--no-warnings", `packages/demo/src/${name}.ts`],
  { stdio: "inherit" }, // inherit the real TTY: setRawMode works, ANSI renders cleanly
);
process.exit(status ?? 0);

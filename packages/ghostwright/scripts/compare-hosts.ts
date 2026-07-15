import { $ } from "bun";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TerminalSession } from "../src/terminal/session.ts";
import { usePtyHostForTesting } from "../src/profile.ts";
import { SidecarClient } from "../src/pty/client.ts";
import { runHostContract } from "../test/host-contract.ts";

const root = new URL("..", import.meta.url).pathname,
  hosts = [
    { name: "Pure C", key: "c", path: `${root}/.cache/hosts/pty-host-c` },
    { name: "Rust", key: "rust", path: `${root}/.cache/hosts/pty-host-rust` },
  ];

async function timed(operation: () => Promise<unknown>) {
  const started = performance.now();
  await operation();
  return performance.now() - started;
}

const buildTimes = {
  c: await timed(() => $`bun ${root}/scripts/build-host-c.ts`.quiet()),
  rust: await timed(() => $`bun ${root}/scripts/build-host-rust.ts`.quiet()),
};

for (const host of hosts) await runHostContract(host.path);

async function launchSamples(hostPath: string) {
  const restore = usePtyHostForTesting(hostPath),
    samples: number[] = [];
  try {
    for (let index = 0; index < 12; index++) {
      const started = performance.now(),
        terminal = await TerminalSession.launch({ command: "/usr/bin/true", trace: "off" });
      await terminal.process.waitForExit();
      await terminal.close();
      samples.push(performance.now() - started);
    }
  } finally {
    restore();
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

async function transportThroughput(hostPath: string) {
  const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    client = await SidecarClient.start(hostPath),
    started = performance.now();
  let bytes = 0,
    exited = false,
    eof = false,
    resolve!: () => void;
  const completed = new Promise<void>((done) => (resolve = done)),
    check = () => {
      if (exited && eof) resolve();
    };
  client.on("output", (chunk) => (bytes += chunk.length));
  client.on("exit", () => {
    exited = true;
    check();
  });
  client.on("eof", () => {
    eof = true;
    check();
  });
  await client.spawn({
    command: process.execPath,
    args: ["-e", `process.stdout.write("x".repeat(1024 * 1024))`],
    cwd: process.cwd(),
    env: environment,
    viewport: { columns: 80, rows: 24, widthPixels: 800, heightPixels: 480 },
    cleanup: { hangupGraceMs: 50, terminateGraceMs: 50, postExitDrainMs: 100 },
  });
  await completed;
  const elapsed = performance.now() - started;
  await client.close();
  return { bytes, elapsed, mibPerSecond: bytes / (1024 * 1024) / (elapsed / 1000) };
}

async function sourceStats(directory: string) {
  const names = (await readdir(directory)).filter((name) => /\.(c|h|rs)$/.test(name)),
    sources = await Promise.all(names.map((name) => readFile(join(directory, name), "utf8")));
  return {
    files: names.length,
    lines: sources.reduce((total, source) => total + source.split("\n").length, 0),
    nonblank: sources.reduce(
      (total, source) => total + source.split("\n").filter((line) => line.trim()).length,
      0,
    ),
    unsafe: sources.reduce(
      (total, source) => total + (source.match(/\bunsafe\b/g)?.length ?? 0),
      0,
    ),
  };
}

const results = [];
for (const host of hosts) {
  const sourceDirectory =
      host.key === "c" ? `${root}/native/pty-host-c` : `${root}/native/pty-host-rust/src`,
    source = await sourceStats(sourceDirectory),
    binary = await stat(host.path),
    launchMedianMs = await launchSamples(host.path),
    throughput = await transportThroughput(host.path);
  results.push({
    ...host,
    source,
    binaryBytes: binary.size,
    buildMs: buildTimes[host.key as keyof typeof buildTimes],
    launchMedianMs,
    throughput,
  });
}

const table = results
  .map(
    (result) =>
      `| ${result.name} | ${result.source.files} | ${result.source.nonblank} | ${result.source.unsafe} | ${(result.binaryBytes / 1024).toFixed(1)} KiB | ${result.buildMs.toFixed(1)} ms | ${result.launchMedianMs.toFixed(1)} ms | ${result.throughput.mibPerSecond.toFixed(1)} MiB/s |`,
  )
  .join("\n");
const document = `# PTY Host C vs. Rust Comparison

Generated on ${new Date().toISOString()} by \`bun run compare:hosts\` on ${process.platform}-${process.arch}.

Both candidates passed the same GWPT/PTY contract before measurement. Candidate outputs are generated under the ignored \`.cache/hosts\` directory and are not included in the npm artifact inventory.

| Implementation | Source files | Nonblank LOC | \`unsafe\` tokens | Stripped binary | Warm build | Median launch/exit | Raw 1 MiB transport |
|---|---:|---:|---:|---:|---:|---:|---:|
${table}

## Pure C

- Compiler: Apple Clang on macOS; native \`musl-gcc\` on Linux release runners.
- Runtime dependencies: system libc on Darwin; static musl on Linux.
- The protocol, ownership rules, and cleanup are explicit, but allocation and file-descriptor cleanup remain manual.
- No Zig code or Zig C compiler is used for the PTY host.

## Rust

- Direct dependencies: \`nix\`, \`minicbor\`, and \`thiserror\`.
- The event loop is synchronous; there is no Tokio or async runtime.
- Owned file descriptors provide automatic parent-side closure. Unsafe code is concentrated around the post-fork child setup and exact ioctl/exec operations.
- The larger binary includes Rust runtime and formatting/panic support despite LTO, aborting panics, and stripping.

## Notes

- “Warm build” includes an incremental Cargo build; a clean Rust build also compiles dependencies and is intentionally reported separately during release evaluation. On macOS the C build command emits both arm64 and x64 binaries while the measured Rust command emits the native binary, so this number is not a single-target compiler comparison.
- Raw transport bypasses Ghostty screen extraction, isolating sidecar throughput.
- Zig remains a maintainer dependency only for building upstream \`ghostty-vt.wasm\`; it is absent from both PTY-host implementations.
`;
await writeFile(`${root}/HOST-COMPARISON.md`, document);
console.log(document);

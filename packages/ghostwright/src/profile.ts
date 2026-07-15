import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ReservedEnvironmentError,
  UnsupportedPlatformError,
  AssetIntegrityError,
  DenoPermissionError,
  LaunchError,
} from "./errors.ts";
import type { TerminalLaunchOptions, Viewport } from "./types.ts";

export const RESERVED_ENVIRONMENT = [
  "TERM",
  "TERMINFO",
  "COLORTERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
] as const;
export const PACKAGE_VERSION = "0.1.0";
let testPtyHostPath: string | undefined;

/** Internal contract-test seam; not exported from the package root. */
export function usePtyHostForTesting(path: string | undefined) {
  const previous = testPtyHostPath;
  testPtyHostPath = path;
  return () => {
    testPtyHostPath = previous;
  };
}
function versionAtLeast(actual: string, required: readonly [number, number]) {
  const [major = 0, minor = 0] = actual.replace(/^v/, "").split(".").map(Number);
  return major > required[0] || (major === required[0] && minor >= required[1]);
}
export function assertSupportedRuntime() {
  const deno = (globalThis as unknown as { Deno?: { version: { deno: string } } }).Deno,
    bun = (globalThis as unknown as { Bun?: { version: string } }).Bun;
  if (deno && !versionAtLeast(deno.version.deno, [2, 2]))
    throw new LaunchError(`Ghostwright requires Deno 2.2 or newer; found ${deno.version.deno}`);
  if (bun && !versionAtLeast(bun.version, [1, 2]))
    throw new LaunchError(`Ghostwright requires Bun 1.2 or newer; found ${bun.version}`);
  if (!deno && !bun && !versionAtLeast(process.versions.node, [22, 0]))
    throw new LaunchError(`Ghostwright requires Node 22 or newer; found ${process.versions.node}`);
}
export function normalizeViewport(input?: Viewport): Required<Viewport> {
  const columns = input?.columns ?? 80,
    rows = input?.rows ?? 24;
  if (
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns <= 0 ||
    rows <= 0 ||
    columns > 65535 ||
    rows > 65535
  )
    throw new RangeError(`Invalid viewport ${columns}x${rows}`);
  const widthPixels = input?.widthPixels ?? columns * 10,
    heightPixels = input?.heightPixels ?? rows * 20;
  if (
    !Number.isInteger(widthPixels) ||
    !Number.isInteger(heightPixels) ||
    widthPixels <= 0 ||
    heightPixels <= 0 ||
    widthPixels > 65535 ||
    heightPixels > 65535
  )
    throw new RangeError(`Invalid pixel viewport ${widthPixels}x${heightPixels}`);
  return { columns, rows, widthPixels, heightPixels };
}
export function profileEnvironment(
  explicit: Readonly<Record<string, string>> | undefined,
  terminfo: string,
) {
  const bad = RESERVED_ENVIRONMENT.filter((k) => Object.hasOwn(explicit ?? {}, k));
  if (bad.length)
    throw new ReservedEnvironmentError(
      `Terminal profile variables cannot be overridden: ${bad.join(", ")}`,
    );
  return {
    ...process.env,
    ...explicit,
    TERM: "xterm-ghostty",
    TERMINFO: terminfo,
    COLORTERM: "truecolor",
    TERM_PROGRAM: "ghostwright",
    TERM_PROGRAM_VERSION: PACKAGE_VERSION,
  } as Record<string, string>;
}
export function target(os = process.platform, arch = process.arch) {
  const key = `${os}-${arch}`;
  const supported = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
  if (!supported.includes(key))
    throw new UnsupportedPlatformError(
      `Unsupported platform ${key}; supported platforms: ${supported.join(", ")}`,
    );
  return key;
}
export async function resolveAssets(options: TerminalLaunchOptions) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../artifacts"),
    bundledHost = resolve(root, `pty-host-${target()}`),
    host = testPtyHostPath ?? bundledHost,
    terminfo = resolve(root, "terminfo");
  try {
    const rr = await realpath(root),
      rh = await realpath(host),
      wasm = await realpath(resolve(root, "ghostty-vt.wasm")),
      terminfoEntry = await realpath(resolve(terminfo, "78/xterm-ghostty"));
    for (const path of [wasm, terminfoEntry, ...(testPtyHostPath ? [] : [rh])])
      if (path !== rr && !path.startsWith(rr + sep))
        throw new AssetIntegrityError(`Runtime asset resolves outside artifact directory: ${path}`);
    const lock = JSON.parse(await readFile(resolve(root, "../ghostty.lock.json"), "utf8"));
    for (const { path, key } of [
      ...(testPtyHostPath ? [] : [{ path: rh, key: `artifacts/${rh.split(sep).at(-1)}` }]),
      { path: wasm, key: "artifacts/ghostty-vt.wasm" },
      {
        path: terminfoEntry,
        key: "artifacts/terminfo/78/xterm-ghostty",
      },
    ]) {
      const expected = lock.artifacts[key]?.sha256;
      const actual = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
      if (!expected || actual !== expected) {
        throw new AssetIntegrityError(
          `${path}: checksum mismatch (expected ${expected ?? "manifest entry"}, got ${actual})`,
        );
      }
    }
    return { root: rr, host: rh, terminfo, wasm };
  } catch (cause) {
    if ("Deno" in globalThis && !(cause instanceof AssetIntegrityError))
      throw new DenoPermissionError(
        `Deno cannot read Ghostwright artifacts. Retry with --allow-read=${root} --allow-run=${host}`,
        { cause },
      );
    throw cause;
  }
}

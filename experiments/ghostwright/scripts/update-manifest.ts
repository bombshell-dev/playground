import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Refreshes the `artifacts` checksum map in ghostty.lock.json.
 *
 * This script used to rebuild the entire lockfile from a hardcoded copy, which
 * silently discarded any field that copy did not know about. Because the
 * hardcoded copy drifted from the committed lockfile, a single `build:artifacts`
 * run would downgrade `bindingVersion` 2 -> 1, delete the `graphics` block, and
 * drop the Kitty graphics entries from `requiredWasmExports`. That made the
 * build non-idempotent: the next `build:ghostty-vt` failed with
 * GW_PATCH_CHECKSUM because it reads `graphics.freestandingPatchSha256`.
 *
 * The lockfile is now the source of truth. Only checksums are rewritten, and
 * only for artifacts this machine actually produced. Targets that were not
 * built locally (for example the Linux hosts on a macOS dev machine) keep their
 * previously recorded checksums rather than being dropped from the manifest.
 */
const root = new URL('../', import.meta.url),
	artifactsRoot = new URL('artifacts/', root),
	lockUrl = new URL('ghostty.lock.json', root),
	lock = JSON.parse(await readFile(lockUrl, 'utf8'));

const built: string[] = [];
for (const name of await readdir(artifactsRoot))
	if (name === 'ghostty-vt.wasm' || name.startsWith('pty-host-')) built.push(name);
for (const name of ['terminfo/67/ghostty', 'terminfo/78/xterm-ghostty'])
	try {
		await stat(new URL(name, artifactsRoot));
		built.push(name);
	} catch {
		// terminfo entry not compiled on this machine; keep any recorded checksum.
	}

const artifacts: Record<string, { sha256: string }> = { ...lock.artifacts },
	refreshed: string[] = [];
for (const name of built.toSorted()) {
	const key = `artifacts/${name}`,
		sha256 = createHash('sha256')
			.update(await readFile(new URL(name, artifactsRoot)))
			.digest('hex');
	if (artifacts[key]?.sha256 !== sha256) refreshed.push(key);
	artifacts[key] = { sha256 };
}

const preserved = Object.keys(artifacts).filter(
	(key) => !built.some((name) => `artifacts/${name}` === key),
);
lock.artifacts = Object.fromEntries(
	Object.entries(artifacts).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);
await writeFile(lockUrl, JSON.stringify(lock, null, '\t') + '\n');

// JSON.stringify expands short arrays that the committed lockfile keeps inline.
// Normalize through the repo formatter so a no-op build produces no diff. This
// is best effort: the lockfile is valid JSON either way.
for (let dir = new URL('./', lockUrl); ; dir = new URL('../', dir)) {
	const bsh = new URL('node_modules/.bin/bsh', dir);
	if (existsSync(bsh)) {
		spawnSync(bsh.pathname, ['format', lockUrl.pathname], { stdio: 'ignore' });
		break;
	}
	if (dir.pathname === '/') break;
}

// oxlint-disable-next-line no-console -- build script
console.log(
	`manifest: ${refreshed.length} checksum(s) updated, ${built.length - refreshed.length} unchanged, ${preserved.length} preserved for targets not built here${
		preserved.length ? ` (${preserved.join(', ')})` : ''
	}`,
);

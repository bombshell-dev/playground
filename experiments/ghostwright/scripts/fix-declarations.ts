import { readdir, readFile, writeFile } from 'node:fs/promises';
// oxlint-disable-next-line no-restricted-imports -- path module needed for path resolution
import { join } from 'node:path';

async function rewrite(directory: string): Promise<void> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await rewrite(path);
		else if (entry.name.endsWith('.d.ts')) {
			const source = await readFile(path, 'utf8');
			await writeFile(path, source.replace(/(from\s+["'][.]{1,2}\/[^"']+)\.ts(["'])/g, '$1.js$2'));
		}
	}
}

await rewrite(new URL('../dist/types', import.meta.url).pathname);

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';
import { bundleFixture } from '@examples/dom-realm';
import type { Plugin } from 'esbuild';

/** Compile real Svelte components for the client, then bundle their browser runtime. */
export async function compileFixture(): Promise<string> {
	const plugin: Plugin = {
		name: 'svelte-example',
		setup(build) {
			build.onLoad({ filter: /\.svelte$/ }, async (args) => {
				const source = await readFile(args.path, 'utf8');
				const result = compile(source, { filename: args.path, generate: 'client', dev: false });
				return {
					contents: result.js.code,
					loader: 'js',
					resolveDir: fileURLToPath(new URL('.', pathToFileURL(args.path))),
				};
			});
		},
	};
	return bundleFixture(new URL('./entry.js', import.meta.url), [plugin]);
}

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Solid's Node default is its SSR runtime. Select the reactive client runtime
// consistently for both application signals and solid-js/universal imports.
export default defineConfig({
	resolve: {
		conditions: ['browser'],
		alias: [
			{
				find: /^solid-js$/,
				replacement: fileURLToPath(import.meta.resolve('solid-js/dist/solid.js')),
			},
		],
	},
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
		server: { deps: { inline: ['solid-js/universal'] } },
	},
});

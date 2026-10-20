import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Keep the spike on source modules so queries and runner matchers share the
// same RegionInspection class, without requiring a Ghostwright package build.
const source = new URL('../../../experiments/ghostwright/src/', import.meta.url);
export default defineConfig({
	resolve: {
		alias: [
			{ find: 'ghostwright/vitest', replacement: fileURLToPath(new URL('vitest.ts', source)) },
			{
				find: 'ghostwright/matchers',
				replacement: fileURLToPath(new URL('runner-matchers.ts', source)),
			},
			{ find: 'ghostwright', replacement: fileURLToPath(new URL('index.ts', source)) },
		],
	},
	test: {
		include: ['spikes/**/*.test.ts'],
		testTimeout: 10_000,
	},
});

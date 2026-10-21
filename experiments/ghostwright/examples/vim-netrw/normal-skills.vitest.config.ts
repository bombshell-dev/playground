import { defineConfig } from 'vitest/config';
export default defineConfig({
	test: {
		include: ['examples/vim-netrw/normal-skills.vitest.ts'],
		maxWorkers: 1,
		testTimeout: 250_000,
	},
});

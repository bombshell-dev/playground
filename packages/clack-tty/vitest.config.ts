import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		testTimeout: 60_000,
		hookTimeout: 30_000,
		teardownTimeout: 30_000,
		// TUI sessions share no state, but ghostwright spawns a PTY sidecar per
		// test; parallel forks each spawn their own — keep them isolated.
		pool: 'forks',
		maxWorkers: 1,
	},
});

import { defineConfig } from 'vitest/config';
import spike from '../../pizza/spikes/vitest.config.ts';

export default defineConfig({
	...spike,
	test: {
		...spike.test,
		include: ['integration/**/*.test.{ts,tsx}'],
		// Encoding runs during terminal disposal, after the test interactions finish.
		testTimeout: process.env.GHOSTWRIGHT_RECORD ? 250_000 : 10_000,
	},
});

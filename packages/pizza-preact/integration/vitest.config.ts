import { defineConfig } from 'vitest/config';
import spike from '../../pizza/spikes/vitest.config.ts';

export default defineConfig({
	...spike,
	test: { ...spike.test, include: ['integration/**/*.test.{ts,tsx}'] },
});

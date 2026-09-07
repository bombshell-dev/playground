import { defineConfig } from 'vitest/config';
export default defineConfig({
	test: { include: ['test/runner-fixtures/vitest.fixture.mjs'], maxWorkers: 1 },
});

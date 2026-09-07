// oxlint-disable-next-line import/no-unassigned-import -- Register the core matchers before clack's matchers.
import 'ghostwright/vitest';
import { expect } from 'vitest';
import { createRunnerMatchers, type RunnerAssertions } from 'ghostwright/matchers';
import { clackMatchers } from './expectations.ts';

expect.extend(createRunnerMatchers(clackMatchers));
declare module 'vitest' {
	interface Assertion<T> extends RunnerAssertions<typeof clackMatchers> {}
}

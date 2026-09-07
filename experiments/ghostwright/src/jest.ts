import { expect } from '@jest/globals';
import { terminalMatchers, type RunnerAssertions } from './runner-matchers.ts';
import type { builtInMatchers } from './matchers.ts';

expect.extend(terminalMatchers);
declare module 'expect' {
	interface Matchers<R extends void | Promise<void>, T = unknown> extends RunnerAssertions<
		typeof builtInMatchers,
		R
	> {}
}

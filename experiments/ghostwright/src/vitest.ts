import { expect, test as base } from 'vitest';
import { launchTerminal, type Terminal } from './async.ts';
import type { TerminalLaunchOptions } from './types.ts';
import { terminalMatchers, type RunnerAssertions } from './runner-matchers.ts';
import { SessionClosedError } from './errors.ts';

expect.extend(terminalMatchers);
declare module 'vitest' {
	interface Assertion<T> extends RunnerAssertions {}
}

class TerminalFixtureCleanupError extends AggregateError {
	constructor(errors: unknown[]) {
		super(errors, 'Terminal fixture cleanup failed');
		this.name = 'TerminalFixtureCleanupError';
	}
}

/** A runner-owned launch fixture. Report the test outcome before disposing its terminals. */
export const test = base.extend<{
	launchTerminal: (options: TerminalLaunchOptions) => Promise<Terminal>;
}>({
	launchTerminal: async ({ task }, use) => {
		const acquisitions: Promise<Terminal>[] = [];
		let closed = false;
		await using ownership = {
			async [Symbol.asyncDispose](): Promise<void> {
				closed = true;
				const failures: unknown[] = [];
				// Acquisition belongs to the fixture even if the test forgot to await it.
				const results = await Promise.allSettled(acquisitions);
				for (const result of results.toReversed()) {
					if (result.status === 'rejected') continue; // The acquisition promise reports its own error.
					const terminal = result.value;
					try {
						if (task.result?.state === 'fail') {
							const failure = task.result.errors?.[0];
							const error = new Error(failure?.message ?? 'Vitest test failed');
							if (failure?.stack) error.stack = failure.stack;
							await terminal.recordFailure(error);
							if (failure) failure.message = error.message;
						}
					} catch (error) {
						failures.push(error);
					} finally {
						try {
							await terminal[Symbol.asyncDispose]();
						} catch (error) {
							failures.push(error);
						}
					}
				}
				if (failures.length) throw new TerminalFixtureCleanupError(failures);
			},
		};
		void ownership;
		await use((options) => {
			if (closed)
				return Promise.reject(new SessionClosedError('Vitest terminal fixture has ended'));
			const acquiring = launchTerminal(options);
			acquisitions.push(acquiring);
			return acquiring;
		});
	},
});

import { call, run } from 'effection';
import type { TerminalLaunchOptions } from './types.ts';
import { execution, useSession, type AsyncExecution } from './execution.ts';
/** Launch a terminal session, run an async body, and clean up when done. */
export async function withTerminalAsync<T>(
	options: TerminalLaunchOptions,
	body: (terminal: AsyncExecution) => Promise<T>,
): Promise<T> {
	return run(function* () {
		const session = yield* useSession(options);
		const terminal = yield* execution(session);
		try {
			const result: T = yield* call(() => Promise.resolve().then(() => body(terminal)));
			if (session.trace.policy === 'on')
				yield* call(() =>
					session.trace.persist(
						'Session completed successfully',
						session.screen.current(),
						session.process.status(),
					),
				);
			return result;
		} catch (error) {
			try {
				const path = yield* call(() =>
					session.trace.persist(error, session.screen.current(), session.process.status()),
				);
				if (path && error instanceof Error) {
					(error as Error & { tracePath?: string }).tracePath = path;
					error.message += `\ntrace artifact: ${path}`;
				}
			} catch (traceError) {
				if (error instanceof Error)
					(error as Error & { suppressed?: unknown[] }).suppressed = [traceError];
			}
			throw error;
		}
	});
}

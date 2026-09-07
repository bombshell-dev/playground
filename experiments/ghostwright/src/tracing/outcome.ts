import type { TerminalSession } from '../terminal/session.ts';

/** Preserve the original failure even when writing its diagnostic artifacts fails. */
export async function recordFailure(session: TerminalSession, error: unknown): Promise<void> {
	try {
		const path = await session.trace.persist(
			error,
			session.screen.current(),
			session.process.status(),
		);
		if (path && error instanceof Error) {
			Object.assign(error, { tracePath: path });
			error.message += `\ntrace artifact: ${path}`;
		}
	} catch (traceError) {
		if (error instanceof Error) Object.assign(error, { suppressed: [traceError] });
	}
}

/** Persist successful sessions only when recording was explicitly requested. */
export async function recordSuccess(session: TerminalSession): Promise<void> {
	if (session.trace.policy === 'on')
		await session.trace.persist(
			'Terminal scope completed',
			session.screen.current(),
			session.process.status(),
		);
}

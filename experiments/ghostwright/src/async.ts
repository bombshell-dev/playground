import { call, run } from "effection";
import type { AsyncTerminal, TerminalLaunchOptions } from "./types.ts";
import { TerminalSession } from "./terminal/session.ts";
export async function withTerminalAsync<T>(
  options: TerminalLaunchOptions,
  body: (terminal: AsyncTerminal) => Promise<T>,
): Promise<T> {
  return run(function* () {
    const session: TerminalSession = yield* call(() => TerminalSession.launch(options));
    try {
      const result: T = yield* call(() => body(session));
      if (session.trace.policy === "on")
        yield* call(() =>
          session.trace.persist(
            "Session completed successfully",
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
    } finally {
      yield* call(() => session.close());
    }
  });
}

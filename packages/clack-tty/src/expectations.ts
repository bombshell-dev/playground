/**
 * Revision-driven assertion helpers for tree locators. Every wait re-arms on
 * timeout because a wake-up can be lost when it races the subscribe window in
 * ghostwright's `waitForChange`; no polling intervals, no sleeps.
 */
import { expectTerminal, type AsyncTerminal } from 'ghostwright';
import type { ClackTtyLocator } from './extension.ts';

export async function expectTreeCondition(
	terminal: AsyncTerminal,
	condition: () => boolean,
	description: string,
	deadlineMs = 15000,
): Promise<unknown> {
	const deadline = Date.now() + deadlineMs;
	for (;;) {
		try {
			return await expectTerminal(terminal).toSatisfy(condition, {
				settleMs: 0,
				timeoutMs: 1000,
			});
		} catch {
			if (Date.now() > deadline) {
				throw new Error(`${description}: condition never converged`);
			}
		}
	}
}

export function expectFocused(
	terminal: AsyncTerminal,
	locator: ClackTtyLocator,
): Promise<unknown> {
	return expectTreeCondition(
		terminal,
		() => {
			const matches = locator.matches();
			return matches.length === 1 && matches[0]!.states.focused;
		},
		`${locator.source} to be focused`,
	);
}

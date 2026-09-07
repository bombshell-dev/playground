export * from './types.ts';
export * from './observations.ts';
export * from './inspection.ts';
export * from './locators.ts';
export * from './matchers.ts';
export * from './conditions.ts';
export { textLocator, type ScreenQueries, type TextQueryOptions } from './queries.ts';
export type { WaitFor, WaitForOptions } from './wait-for.ts';
export type { LocatedMouse, MouseTarget, DragOffset } from './mouse.ts';
export { AsyncExecution, type Capture, type CaptureOptions } from './execution.ts';
import { AsyncExecution } from './execution.ts';
export * from './errors.ts';
export { isValidKeyName, parseKey } from './keys.ts';
export { styleMatches, cellsMatchStyle, describeColor } from './styles.ts';
export { launchTerminal, Terminal, withTerminal } from './async.ts';
export type { EffectionTerminal } from './effection/index.ts';
export { replayTrace, type ReplayResult, type ReplayOptions } from './tracing/replay.ts';
import { expectTerminal as expectAsync } from './assertions/index.ts';
import { EffectionLocator, EffectionTerminal, expectOperation } from './effection/index.ts';
import { InvalidOptionsError } from './errors.ts';
import { Locator, TerminalSession } from './terminal/session.ts';
import type {
	AsyncLocator,
	AsyncLocatorExpectation,
	AsyncTerminal,
	AsyncTerminalExpectation,
	OperationLocator,
	OperationLocatorExpectation,
	OperationTerminal,
	OperationTerminalExpectation,
} from './types.ts';

/** Create an assertion expectation for a terminal or locator (async or effection). */
export function expectTerminal(target: OperationLocator): OperationLocatorExpectation;
export function expectTerminal(target: AsyncLocator): AsyncLocatorExpectation;
export function expectTerminal(target: OperationTerminal): OperationTerminalExpectation;
export function expectTerminal(target: AsyncTerminal): AsyncTerminalExpectation;
export function expectTerminal(
	target: OperationLocator | OperationTerminal | AsyncLocator | AsyncTerminal,
):
	| OperationLocatorExpectation
	| AsyncLocatorExpectation
	| OperationTerminalExpectation
	| AsyncTerminalExpectation {
	if (target instanceof AsyncExecution) return expectAsync(target.session);
	if (target instanceof EffectionLocator || target instanceof EffectionTerminal)
		return expectOperation(target);
	if (target instanceof Locator) return expectAsync(target);
	if (target instanceof TerminalSession) return expectAsync(target);
	throw new InvalidOptionsError('Expected a Ghostwright terminal or locator');
}

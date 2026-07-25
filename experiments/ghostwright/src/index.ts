export * from './types.ts';
export * from './errors.ts';
export { withTerminalAsync } from './async.ts';
export { withTerminal } from './effection/index.ts';
export { replayTrace, type ReplayResult } from './tracing/replay.ts';
import { expectTerminal as expectAsync } from './assertions/index.ts';
import { EffectionLocator, EffectionTerminal, expectOperation } from './effection/index.ts';
import { Locator, type TerminalSession } from './terminal/session.ts';
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
	return (
		target instanceof EffectionLocator || target instanceof EffectionTerminal
			? expectOperation(target)
			: expectAsync(target instanceof Locator ? target : (target as unknown as TerminalSession))
	) as
		| OperationLocatorExpectation
		| AsyncLocatorExpectation
		| OperationTerminalExpectation
		| AsyncTerminalExpectation;
}

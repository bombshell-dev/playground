export * from './types.ts';
export * from './errors.ts';
export { withTerminalAsync } from './async.ts';
export { withTerminal } from './effection/index.ts';
export { replayTrace, type ReplayResult } from './tracing/replay.ts';
import { expectTerminal as expectAsync } from './assertions/index.ts';
import { EffectionLocator, EffectionTerminal, expectOperation } from './effection/index.ts';
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
			: expectAsync(target as any)
	) as
		| OperationLocatorExpectation
		| AsyncLocatorExpectation
		| OperationTerminalExpectation
		| AsyncTerminalExpectation;
}

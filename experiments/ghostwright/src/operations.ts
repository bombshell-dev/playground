// oxlint-disable bombshell-dev/exported-function-async -- Composition constructs functions; execution returns Effection Operations.
import type { Operation } from 'effection';
import type { ActionReceipt, KeyName, KeyPress, TraceableInputOptions } from './types.ts';
import type { Capture, CaptureOptions } from './execution.ts';

/** A typed continuation around one operation. First middleware is outermost. */
export type OperationMiddleware<Args extends unknown[], Result> = (
	args: Args,
	next: (...args: Args) => Operation<Result>,
) => Operation<Result>;

/** Compose without capturing a scope; execution belongs to the caller. */
export function composeOperation<Args extends unknown[], Result>(
	driver: (...args: Args) => Operation<Result>,
	middleware: readonly (OperationMiddleware<Args, Result> | undefined)[],
): (...args: Args) => Operation<Result> {
	return middleware.reduceRight(
		(next, around) => (around ? (...args) => around(args, next) : next),
		driver,
	);
}

/** Input capability implemented by a driver and exposed through middleware. */
export interface KeyboardOperations {
	press(key: KeyName | KeyPress): Operation<ActionReceipt>;
	type(text: string, options?: TraceableInputOptions): Operation<ActionReceipt>;
	paste(text: string, options?: TraceableInputOptions): Operation<ActionReceipt>;
	focus(state: 'in' | 'out'): Operation<ActionReceipt>;
	write(data: Uint8Array): Operation<ActionReceipt>;
}

export type KeyboardMiddleware = {
	readonly [K in keyof KeyboardOperations]?: KeyboardOperations[K] extends (
		...args: infer Args
	) => Operation<infer Result>
		? OperationMiddleware<Args, Result>
		: never;
};

/** Build a middleware-preserving capability from an explicitly supplied driver. */
export function createKeyboardOperations(options: {
	readonly driver: KeyboardOperations;
	readonly middleware?: readonly KeyboardMiddleware[];
}): KeyboardOperations {
	const { driver, middleware = [] } = options;
	return Object.freeze({
		press: composeOperation(
			(...args: Parameters<KeyboardOperations['press']>) => driver.press(...args),
			middleware.map((m) => m.press),
		),
		type: composeOperation(
			(...args: Parameters<KeyboardOperations['type']>) => driver.type(...args),
			middleware.map((m) => m.type),
		),
		paste: composeOperation(
			(...args: Parameters<KeyboardOperations['paste']>) => driver.paste(...args),
			middleware.map((m) => m.paste),
		),
		focus: composeOperation(
			(...args: Parameters<KeyboardOperations['focus']>) => driver.focus(...args),
			middleware.map((m) => m.focus),
		),
		write: composeOperation(
			(...args: Parameters<KeyboardOperations['write']>) => driver.write(...args),
			middleware.map((m) => m.write),
		),
	});
}

/** Reusable work receives capabilities, never a raw driver or captured Scope. */
export type TerminalProgram<Result> = (terminal: ExecutionOperations) => Operation<Result>;

/** The initial operation core covers keyboard input and scoped capture. */
export interface ExecutionOperations {
	readonly keyboard: KeyboardOperations;
	capture(options: CaptureOptions, body: TerminalProgram<unknown>): Operation<Capture>;
}

/** Subscribe before invoking the continuation; retain capture's completion rules. */
export function captureProgram(
	options: CaptureOptions,
	body: TerminalProgram<unknown>,
): TerminalProgram<Capture> {
	return (terminal) => terminal.capture(options, body);
}

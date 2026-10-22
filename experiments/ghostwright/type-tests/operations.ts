import type { Operation } from 'effection';
import {
	captureProgram,
	type ActionReceipt,
	type AsyncExecution,
	type Capture,
	type CaptureOptions,
	type EffectionTerminal,
	type KeyboardMiddleware,
	type TerminalProgram,
} from '../src/index.ts';

declare const asyncTerminal: AsyncExecution;
declare const nativeTerminal: EffectionTerminal;
declare const options: CaptureOptions;

const program: TerminalProgram<ActionReceipt> = function* ({ keyboard }) {
	// @ts-expect-error Raw input accepts bytes, not strings.
	yield* keyboard.write('hello');
	return yield* keyboard.press('Enter');
};
const asyncResult: Promise<ActionReceipt> = asyncTerminal.run(program);
const nativeResult: Operation<ActionReceipt> = nativeTerminal.run(program);
const recorded: Promise<Capture> = asyncTerminal.run(captureProgram(options, program));
// @ts-expect-error Capturing returns evidence, not the continuation's return value.
const receipt: Promise<ActionReceipt> = asyncTerminal.run(captureProgram(options, program));
const middleware: KeyboardMiddleware = {
	*press(args, next) {
		// @ts-expect-error The continuation preserves the key argument type.
		yield* next(42);
		const result: ActionReceipt = yield* next(...args);
		return result;
	},
	// @ts-expect-error Middleware must preserve the action receipt result type.
	*write(args, next) {
		yield* next(...args);
		return 'written';
	},
};
void [asyncResult, nativeResult, recorded, receipt, middleware];

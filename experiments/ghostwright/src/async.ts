import { createScope, suspend, useAbortSignal, useScope, type Scope } from 'effection';
import type { TerminalSession } from './terminal/session.ts';
import type { TerminalLaunchOptions, ActionReceipt } from './types.ts';
import { AsyncExecution, useSession } from './execution.ts';
import { recordFailure, recordSuccess } from './tracing/outcome.ts';
import { SessionClosedError } from './errors.ts';

/** An owned execution scope. Locators and capture results do not own this lifetime. */
export class Terminal extends AsyncExecution implements AsyncDisposable {
	#disposing?: Promise<void>;
	#failureRecorded = false;
	private readonly disposeScope: () => Promise<void>;
	constructor(owner: {
		session: TerminalSession;
		scope: Scope;
		signal: AbortSignal;
		dispose(): Promise<void>;
	}) {
		super(owner.session, owner.scope, owner.signal);
		this.disposeScope = owner.dispose;
	}
	/** Runner fixtures can report failures that async disposal cannot observe. */
	recordFailure = async (error: unknown): Promise<void> => {
		this.#failureRecorded = true;
		await recordFailure(this.session, error);
	};
	// Publish the disposal promise before abort listeners can reenter this method.
	[Symbol.asyncDispose] = (): Promise<void> =>
		(this.#disposing ??= Promise.resolve().then(() => this.#dispose()));
	async #dispose(): Promise<void> {
		await this.disposeScope();
		if (!this.#failureRecorded) await recordSuccess(this.session);
	}
	override close = async (): Promise<ActionReceipt> => {
		await this[Symbol.asyncDispose]();
		return this.session.close();
	};
}

/** Launch an owned terminal. Use await using, close(), or a runner fixture to release it. */
export async function launchTerminal(options: TerminalLaunchOptions): Promise<Terminal> {
	const scope = createScope();
	const controller = new AbortController();
	const dispose = async (): Promise<void> => {
		controller.abort(new SessionClosedError('Terminal scope disposed'));
		await scope[Symbol.asyncDispose]();
	};
	let resolveReady!: (terminal: Terminal) => void;
	let rejectReady!: (error: unknown) => void;
	const ready = new Promise<Terminal>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const lifetime = scope.run(function* () {
		const session = yield* useSession(options);
		const terminal = new Terminal({
			session,
			scope: yield* useScope(),
			signal: AbortSignal.any([controller.signal, yield* useAbortSignal()]),
			dispose,
		});
		resolveReady(terminal);
		yield* suspend();
	});
	// A failed launch rejects acquisition. Normal disposal halts this task after
	// acquisition; its rejection is still observed, rather than left unhandled.
	void lifetime.catch(rejectReady);
	try {
		return await ready;
	} catch (error) {
		await dispose();
		throw error;
	}
}

/** Run a test body with the same owned lifetime as launchTerminal. */
export async function withTerminal<T>(
	options: TerminalLaunchOptions,
	body: (terminal: AsyncExecution) => Promise<T>,
): Promise<T> {
	await using terminal = await launchTerminal(options);
	try {
		return await body(terminal);
	} catch (error) {
		await terminal.recordFailure(error);
		throw error;
	}
}

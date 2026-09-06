import {
	action,
	call,
	race,
	resource,
	scoped,
	sleep,
	spawn,
	useAbortSignal,
	useScope,
	withResolvers,
	type Operation,
	type Scope,
} from 'effection';
import {
	GhostwrightError,
	InvalidOptionsError,
	ProcessExitedError,
	SessionClosedError,
	StrictLocatorError,
	TerminalAssertionError,
} from './errors.ts';
import { createExpect, type Matcher, type MatchResult } from './matchers.ts';
import type { RegionLocator } from './locators.ts';
import type { RegionInspection } from './inspection.ts';
import type { Condition } from './conditions.ts';
import type { Observation } from './observations.ts';
import { TerminalSession } from './terminal/session.ts';
import type { ActionReceipt, AsyncTerminal, MouseOptions, TerminalLaunchOptions } from './types.ts';

export interface CaptureOptions {
	readonly until: Condition;
	readonly timeoutMs?: number;
	readonly maxObservations?: number;
	readonly maxBytes?: number;
	readonly signal?: AbortSignal;
}
export interface Capture {
	readonly baseline: Observation;
	readonly startedAt: number;
	readonly completedAt: number;
	readonly observations: readonly Observation[];
}
const expectRegion = createExpect();
const error = (code: string, message: string): GhostwrightError =>
	new GhostwrightError({ code, message });
function timeout(milliseconds: number, code: string): Operation<never> {
	if (!Number.isFinite(milliseconds) || milliseconds < 0)
		throw new InvalidOptionsError('timeoutMs must be nonnegative and finite');
	return (function* () {
		yield* sleep(milliseconds);
		throw error(code, `Deadline exceeded after ${milliseconds} ms`);
	})();
}
function aborted(signal: AbortSignal): Operation<never> {
	return action((_resolve, reject) => {
		const abort = (): void => reject(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		return () => signal.removeEventListener('abort', abort);
	});
}
// oxlint-disable-next-line bombshell-dev/max-params -- internal deadline/error/cancellation boundary
function* bounded<T>(
	operation: Operation<T>,
	milliseconds: number,
	code: string,
	signal?: AbortSignal,
): Operation<T> {
	signal?.throwIfAborted();
	return yield* race([
		operation,
		timeout(milliseconds, code),
		...(signal ? [aborted(signal)] : []),
	]);
}
function ended(session: TerminalSession): Error | undefined {
	const status = session.process.status();
	if (status.state === 'closed' || status.state === 'failed')
		return new SessionClosedError('Terminal closed before condition matched');
	if (status.ptyEof) return new ProcessExitedError('PTY reached EOF before condition matched');
}

/** All wait resources are Effection actions; cancellation always removes them. */
// oxlint-disable-next-line bombshell-dev/max-params -- internal session/query/evidence boundary
function awaitMatch(
	session: TerminalSession,
	locator: RegionLocator,
	matcher: Matcher,
): Operation<RegionInspection> {
	return action((resolve, reject) => {
		const check = (observation?: Observation): void => {
			if (!observation || !locator.accepts(observation)) return;
			try {
				const matches = locator.resolve(observation);
				if (matches.length > 1)
					throw new StrictLocatorError(`${locator.source} matched ${matches.length} regions`);
				if (matches[0]) {
					const result = matcher(matches[0]);
					if (result.pass) resolve(matches[0]);
				}
			} catch (cause) {
				reject(cause as Error);
			}
		};
		const off = session.observations.subscribe(check);
		const offStatus = session.subscribe(() => {
			const cause = ended(session);
			if (cause) reject(cause);
		});
		check(session.observations.current(locator.extensionId));
		const cause = ended(session);
		if (cause) reject(cause);
		return () => {
			off();
			offStatus();
		};
	});
}

/** A scope-bound executor. Queries and matchers themselves own no lifetime. */
export class AsyncExecution implements AsyncTerminal {
	readonly keyboard: AsyncTerminal['keyboard'];
	readonly mouse: AsyncTerminal['mouse'];
	readonly process: AsyncTerminal['process'];
	readonly revisions: AsyncTerminal['revisions'];
	readonly history: AsyncTerminal['history'];
	readonly graphics: AsyncTerminal['graphics'];
	readonly session: TerminalSession;
	private readonly scope: Scope;
	readonly signal: AbortSignal;
	constructor(session: TerminalSession, scope: Scope, signal: AbortSignal) {
		this.session = session;
		this.scope = scope;
		this.signal = signal;
		this.keyboard = this.#bind(session.keyboardFor(signal));
		this.mouse = this.#bind(session.mouseFor(signal));
		this.process = {
			status: () => session.process.status(),
			signal: (name, target) => this.#promise(() => session.signalProcess(name, target, signal)),
			waitForExit: (...args) => this.#promise(() => session.process.waitForExit(...args)),
		};
		this.revisions = this.#bind(session.revisions);
		this.history = this.#bind(session.history);
		this.graphics = this.#bind(session.graphics);
	}
	#bind<T extends Record<string, (...args: never[]) => Promise<unknown>>>(methods: T): T {
		const bind =
			<Args extends unknown[], Result>(method: (...args: Args) => Promise<Result>) =>
			(...args: Args): Promise<Result> =>
				this.#promise(() => method(...args));
		// Object.fromEntries loses the association between each key and its signature.
		return Object.fromEntries(
			Object.entries(methods).map(([name, method]) => [name, bind(method)]),
		) as T;
	}
	async #run<T>(operation: () => Operation<T>): Promise<T> {
		this.signal.throwIfAborted();
		// Return failures as data across Scope.run so a caller can catch an operation
		// failure without poisoning the enclosing session's task group.
		const outcome = await this.scope.run(function* () {
			try {
				return { ok: true as const, value: yield* scoped(operation) };
			} catch (cause) {
				return { ok: false as const, cause };
			}
		});
		if (!outcome.ok) throw outcome.cause;
		return outcome.value;
	}
	#promise<T>(fn: () => Promise<T>): Promise<T> {
		return this.#run(() => call(fn));
	}
	get screen(): AsyncTerminal['screen'] {
		return this.session.screen;
	}
	getByText(
		...args: Parameters<AsyncTerminal['getByText']>
	): ReturnType<TerminalSession['getByText']> {
		return this.session.getByText(...args);
	}
	region(...args: Parameters<AsyncTerminal['region']>): ReturnType<TerminalSession['region']> {
		return this.session.region(...args);
	}
	resize(viewport: Parameters<AsyncTerminal['resize']>[0]): Promise<ActionReceipt> {
		return this.#promise(() => this.session.resize(viewport, this.signal));
	}
	close(): Promise<ActionReceipt> {
		return this.#promise(() => this.session.close());
	}
	expect(locator: RegionLocator): ReturnType<typeof expectRegion> {
		return expectRegion(this, locator);
	}
	assert(locator: RegionLocator, matcher: Matcher): Promise<RegionInspection> {
		return this.#run(() => assertRegion(this.session, locator, matcher));
	}
	async click(locator: RegionLocator, options?: MouseOptions): Promise<ActionReceipt> {
		const region = await this.assert(locator, (actual) => ({
			pass: !!actual.visibleBounds,
			expected: 'on-screen region',
			actual: actual.bounds,
		}));
		this.signal.throwIfAborted();
		const bounds = region.visibleBounds!;
		return this.mouse.click(
			{
				column: bounds.column + Math.floor((bounds.width - 1) / 2),
				row: bounds.row + Math.floor((bounds.height - 1) / 2),
			},
			options,
		);
	}
	capture(
		options: CaptureOptions,
		body: (execution: AsyncExecution) => Promise<unknown>,
	): Promise<Capture> {
		return this.#run(() =>
			captureOperation(this.session, options, (child) =>
				call(() => Promise.resolve().then(() => body(child))),
			),
		);
	}
}

// oxlint-disable-next-line bombshell-dev/max-params -- shared async/operation matcher executor
export function* assertRegion(
	session: TerminalSession,
	locator: RegionLocator,
	matcher: Matcher,
): Operation<RegionInspection> {
	if (locator.extensionId && !session.hasExtension(locator.extensionId))
		throw error('GW_EXTENSION_NOT_REGISTERED', `Locator requires extension ${locator.extensionId}`);
	let last: MatchResult | undefined;
	try {
		return yield* bounded(
			awaitMatch(session, locator, (actual) => (last = matcher(actual))),
			session.options.assertionTimeoutMs ?? 4000,
			'GW_ASSERTION',
		);
	} catch (cause) {
		if (cause instanceof GhostwrightError && cause.code === 'GW_ASSERTION')
			throw new TerminalAssertionError(
				`${locator.source}: ${last ? JSON.stringify(last) : 'no located region'}\n${session.screen.getText()}`,
				{ cause },
			);
		if (cause instanceof ProcessExitedError || cause instanceof SessionClosedError) {
			const ErrorType =
				cause instanceof ProcessExitedError ? ProcessExitedError : SessionClosedError;
			throw new ErrorType(`${locator.source}: ${cause.message}`, { cause });
		}
		throw cause;
	}
}

export function* execution(session: TerminalSession): Operation<AsyncExecution> {
	return new AsyncExecution(session, yield* useScope(), yield* useAbortSignal());
}

// oxlint-disable-next-line bombshell-dev/max-params -- shared async/operation capture executor
export function* captureOperation(
	session: TerminalSession,
	options: CaptureOptions,
	body: (execution: AsyncExecution) => Operation<unknown>,
): Operation<Capture> {
	const max = options.maxObservations ?? 1000,
		maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
	if (!Number.isSafeInteger(max) || max <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0)
		throw new InvalidOptionsError('Capture limits must be positive safe integers');
	return yield* bounded(
		scoped(function* () {
			const child = yield* execution(session);
			const startedAt = performance.now(),
				baseline = session.observations.current()!;
			const state = options.until.create(startedAt),
				observations: Observation[] = [];
			state.baseline?.(baseline);
			const completion = withResolvers<Capture>();
			let bytes = 0,
				finished = false;
			const recording = yield* resource<{ stop(): void }>(function* (provide) {
				let timer: ReturnType<typeof setTimeout> | undefined;
				let off = (): void => {},
					offStatus = (): void => {};
				const stop = (): void => {
					finished = true;
					off();
					offStatus();
					clearTimeout(timer);
				};
				const finish = (): void => {
					stop();
					completion.resolve(
						Object.freeze({
							baseline,
							startedAt,
							completedAt: performance.now(),
							observations: Object.freeze([...observations]),
						}),
					);
				};
				const fail = (cause: unknown): void => {
					stop();
					completion.reject(cause as Error);
				};
				const schedule = (): void => {
					clearTimeout(timer);
					if (!finished && state.wakeAt !== undefined)
						timer = setTimeout(
							() => {
								try {
									if (state.wake?.(performance.now())) finish();
									else schedule();
								} catch (cause) {
									fail(cause);
								}
							},
							Math.max(0, state.wakeAt - performance.now()),
						);
				};
				off = session.observations.subscribe((observation) => {
					if (finished) return;
					try {
						bytes += JSON.stringify(observation).length * 2;
						if (observations.length === max || bytes > maxBytes)
							throw error(
								'GW_CAPTURE_LIMIT',
								'Capture storage limit exceeded; recording is incomplete',
							);
						observations.push(observation);
						if (state.observe(observation)) finish();
						else schedule();
					} catch (cause) {
						fail(cause);
					}
				});
				offStatus = session.subscribe(() => {
					const cause = ended(session);
					if (!finished && cause) fail(cause);
				});
				schedule();
				try {
					yield* provide({ stop });
				} finally {
					stop();
				}
			});
			try {
				const cause = ended(session);
				if (cause) throw cause;
				const task = yield* spawn(() => body(child));
				const result = yield* completion.operation;
				yield* task;
				return result;
			} finally {
				recording.stop();
			}
		}),
		options.timeoutMs ?? session.options.assertionTimeoutMs ?? 4000,
		'GW_CAPTURE_TIMEOUT',
		options.signal,
	);
}

/** Cancellation waits for bounded acquisition and closes even a late launch. */
export function useSession(options: TerminalLaunchOptions): Operation<TerminalSession> {
	return resource(function* (provide) {
		const launching = TerminalSession.launch(options).then(
			(session) => ({ ok: true as const, session }),
			(cause) => ({ ok: false as const, cause }),
		);
		try {
			const result = yield* call(() => launching);
			if (!result.ok) throw result.cause;
			yield* provide(result.session);
		} finally {
			const result = yield* call(() => launching);
			if (result.ok) yield* call(() => result.session.close());
		}
	});
}

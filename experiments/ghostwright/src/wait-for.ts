import { action, type Operation } from 'effection';
import { GhostwrightError, InvalidOptionsError } from './errors.ts';

export interface WaitForOptions {
	readonly timeoutMs?: number;
	readonly intervalMs?: number;
	readonly signal?: AbortSignal;
}
export interface WaitSource {
	subscribe(callback: () => void): () => void;
	diagnostics(): string;
	readonly timeoutMs: number;
}
export type WaitFor = <T>(
	callback: () => T | PromiseLike<T>,
	options?: WaitForOptions,
) => Promise<T>;

/** Retry assertions, not actions. Observations accelerate the interval fallback. */
// oxlint-disable-next-line bombshell-dev/max-params -- callback, event source, and wait policy
export function waitForOperation<T>(
	callback: () => T | PromiseLike<T>,
	source: WaitSource,
	options: WaitForOptions = {},
): Operation<T> {
	const timeoutMs = options.timeoutMs ?? source.timeoutMs;
	const intervalMs = options.intervalMs ?? 50;
	// Node-compatible timers clamp larger delays to 1 ms rather than waiting.
	if (
		![timeoutMs, intervalMs].every(
			(value) => Number.isFinite(value) && value >= 0 && value <= 2_147_483_647,
		)
	)
		throw new InvalidOptionsError(
			'Wait timeoutMs and intervalMs must be finite and between 0 and 2147483647',
		);
	return action((resolve, reject) => {
		let finished = false;
		let active = false;
		let dirty = false;
		let lastError: unknown;
		let retry: ReturnType<typeof setTimeout> | undefined;
		const attempt = (): void => {
			if (finished) return;
			if (active) {
				dirty = true;
				return;
			}
			clearTimeout(retry);
			active = true;
			dirty = false;
			// Run user code outside Effection's dispatcher, including runner assertions.
			void Promise.resolve().then(async () => {
				if (finished) return;
				try {
					const value = await callback();
					if (!finished) {
						finished = true;
						resolve(value);
					}
				} catch (error) {
					active = false;
					if (finished) return;
					lastError = error;
					if (dirty) queueMicrotask(attempt);
					else retry = setTimeout(attempt, intervalMs);
				}
			});
		};
		const off = source.subscribe(attempt);
		const deadline = setTimeout(() => {
			if (finished) return;
			finished = true;
			const detail =
				lastError instanceof Error
					? lastError.message
					: String(lastError ?? 'Callback has not completed');
			reject(
				new GhostwrightError({
					code: 'GW_WAIT_TIMEOUT',
					message: `waitFor timed out after ${timeoutMs} ms: ${detail}\n${source.diagnostics()}`,
					cause: lastError,
				}),
			);
		}, timeoutMs);
		const abort = (): void => {
			if (!finished) {
				finished = true;
				reject(options.signal!.reason);
			}
		};
		options.signal?.addEventListener('abort', abort, { once: true });
		if (options.signal?.aborted) abort();
		else attempt();
		return () => {
			finished = true;
			off();
			clearTimeout(retry);
			clearTimeout(deadline);
			options.signal?.removeEventListener('abort', abort);
		};
	});
}

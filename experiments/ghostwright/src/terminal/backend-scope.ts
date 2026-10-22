import { createScope, suspend, type Scope } from 'effection';
import type { BackendOptions, CreateBackend, TerminalBackend } from '../backend.ts';
import { createGhosttyBackend } from './ghostty-backend.ts';

export interface BackendScope extends AsyncDisposable {
	readonly backend: TerminalBackend;
}

/** Async owners explicitly dispose this scope after draining their output. */
export async function openBackend(
	options: BackendOptions,
	ownership: { create?: CreateBackend; parent?: Scope } = {},
): Promise<BackendScope> {
	const scope = createScope(ownership.parent);
	const create = ownership.create ?? createGhosttyBackend;
	let resolve!: (backend: TerminalBackend) => void;
	let reject!: (error: unknown) => void;
	const ready = new Promise<TerminalBackend>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	const lifetime = scope.run(function* () {
		resolve(yield* create(options));
		yield* suspend();
	});
	void lifetime.catch(reject);
	let closing: Promise<void> | undefined;
	const close = (): Promise<void> =>
		(closing ??= Promise.resolve().then(() => scope[Symbol.asyncDispose]()));
	try {
		return { backend: await ready, [Symbol.asyncDispose]: close };
	} catch (error) {
		await close();
		throw error;
	}
}

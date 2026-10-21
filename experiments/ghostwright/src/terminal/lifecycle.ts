import { ExtensionLifecycleError } from '../errors.ts';
import type {
	ScreenSnapshot,
	TerminalInteraction,
	TerminalExtensionDefinition,
	TerminalExtensionContext,
} from '../types.ts';

/** Shared by local and PTY connections. Extensions own retention and async export. */
export class ExtensionLifecycle {
	readonly #frames = new Set<(screen: ScreenSnapshot) => void>();
	readonly #actions = new Set<(action: TerminalInteraction) => void>();
	readonly #cleanup: (() => void | Promise<void>)[] = [];
	#closing?: Promise<void>;
	constructor(private readonly current: () => ScreenSnapshot) {}
	async install(extensions: readonly TerminalExtensionDefinition[]): Promise<void> {
		const context: TerminalExtensionContext = {
			current: this.current,
			onFrame: (listener) => {
				this.#frames.add(listener);
				return () => {
					this.#frames.delete(listener);
				};
			},
			onAction: (listener) => {
				this.#actions.add(listener);
				return () => {
					this.#actions.delete(listener);
				};
			},
		};
		try {
			for (const extension of extensions) {
				const cleanup = extension.setup?.(context);
				if (cleanup) this.#cleanup.push(cleanup);
			}
		} catch (error) {
			try {
				await this.close();
			} catch (cleanupError) {
				throw new ExtensionLifecycleError('Extension setup and cleanup failed', [
					error,
					cleanupError,
				]);
			}
			throw error;
		}
	}
	frame(screen: ScreenSnapshot): void {
		for (const listener of this.#frames) listener(screen);
	}
	action(action: TerminalInteraction): void {
		for (const listener of this.#actions) listener(action);
	}
	close(): Promise<void> {
		return (this.#closing ??= Promise.resolve().then(async () => {
			this.#frames.clear();
			this.#actions.clear();
			const errors: unknown[] = [];
			for (const cleanup of this.#cleanup.toReversed()) {
				try {
					await cleanup();
				} catch (error) {
					errors.push(error);
				}
			}
			if (errors.length)
				throw new ExtensionLifecycleError('Terminal extension cleanup failed', errors);
		}));
	}
}

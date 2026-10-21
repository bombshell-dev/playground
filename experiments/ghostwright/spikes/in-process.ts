import { Readable, Writable } from 'node:stream';
import { run } from 'effection';
import { GhostwrightError, SessionClosedError } from '../src/errors.ts';
import { parseKey } from '../src/keys.ts';
import { normalizeViewport } from '../src/profile.ts';
import { createQueries } from '../src/queries.ts';
import { TerminalOutput } from '../src/terminal/output.ts';
import { GhosttyWasmTerminal } from '../src/terminal/wasm.ts';
import { waitForOperation, type WaitForOptions } from '../src/wait-for.ts';
import type {
	KeyName,
	KeyPress,
	ScreenSnapshot,
	TerminalLaunchOptions,
	Viewport,
} from '../src/types.ts';

/** Experimental connection: no command, child process, native host, or global stream replacement. */
export async function createTerminal(options: InProcessOptions = {}): Promise<InProcessTerminal> {
	const viewport = normalizeViewport(options.viewport);
	const engine = await GhosttyWasmTerminal.create(viewport);
	try {
		return new InProcessTerminal(engine, options);
	} catch (error) {
		engine.free();
		throw error;
	}
}

type InProcessOptions = Pick<
	TerminalLaunchOptions,
	'viewport' | 'extensions' | 'selector' | 'assertionTimeoutMs'
>;

/** Buffer early input until the app installs its reader, even if it calls resume first. */
class Input extends Readable {
	readonly isTTY = true;
	isRaw = false;
	override _read(): void {}
	setRawMode(raw: boolean): this {
		this.isRaw = raw;
		return this;
	}
	override resume(): this {
		return this.listenerCount('data') ? super.resume() : this;
	}
}

class Output extends Writable {
	readonly isTTY = true;
	columns = 80;
	rows = 24;
	getColorDepth(): number {
		return 24;
	}
	hasColors(): boolean {
		return true;
	}
	getWindowSize(): [number, number] {
		return [this.columns, this.rows];
	}
}

class InProcessTerminal implements AsyncDisposable {
	readonly stdin = new Input();
	readonly stdout: Output;
	readonly appIO: { input: Input; output: Output };
	readonly screen;
	readonly keyboard;
	readonly #engine: GhosttyWasmTerminal;
	readonly #output: TerminalOutput;
	readonly #controller = new AbortController();
	readonly #options: InProcessOptions;
	#snapshot;
	#revision = 0;
	#commands: Promise<void> = Promise.resolve();
	#applications: Promise<void>[] = [];
	#failure: unknown;
	#closing?: Promise<void>;

	constructor(engine: GhosttyWasmTerminal, options: InProcessOptions) {
		this.#engine = engine;
		this.#options = options;
		this.#snapshot = engine.snapshot();
		this.#output = new TerminalOutput(
			options.extensions ?? [],
			() => this.#snapshot,
			(bytes) => {
				engine.write(bytes);
				return this.#observe();
			},
		);
		this.stdout = new Output({
			write: (chunk: Buffer, _encoding, done) => {
				try {
					this.#ensureOpen();
					this.#output.push(chunk);
					for (const effect of engine.takeEffects()) {
						if (effect.type === 'write-pty') {
							// Never reenter app rendering from a Ghostty output callback.
							void this.#send(effect.data).catch((error) => this.#fail(error));
						}
					}
					done();
				} catch (error) {
					done(error instanceof Error ? error : new Error(String(error)));
				}
			},
		});
		this.stdout.on('error', (error) => this.#fail(error));
		Object.assign(this.stdout, this.#snapshot.viewport);
		this.appIO = { input: this.stdin, output: this.stdout };
		this.screen = {
			...createQueries({
				current: (locator) => {
					this.#ensureOpen();
					return locator.extensionId
						? this.#output.observations.current(locator.extensionId)
						: this.#output.observations.currentScreen();
				},
				waitFor: this.waitFor,
				selector: options.selector,
			}),
			current: () => {
				this.#ensureOpen();
				return this.#snapshot;
			},
			getText: () => {
				this.#ensureOpen();
				return this.#snapshot.lines
					.map((line) =>
						line.cells
							.map((cell) =>
								cell.continuation ? '' : cell.style.invisible ? ' ' : cell.text || ' ',
							)
							.join(''),
					)
					.join('\n');
			},
		};
		this.keyboard = {
			press: async (key: KeyName | KeyPress) => {
				this.#ensureOpen();
				await this.#send(engine.encodeKey(parseKey(key)));
			},
			type: async (text: string) => {
				this.#ensureOpen();
				await this.#send(Buffer.concat(Array.from(text, (key) => engine.encodeKey(key))));
			},
			paste: async (text: string) => {
				this.#ensureOpen();
				await this.#send(engine.encodePaste(text));
			},
		};
	}

	#observe(): ScreenSnapshot {
		this.#snapshot = Object.freeze({ ...this.#engine.snapshot(), sequence: ++this.#revision });
		return this.#snapshot;
	}
	#ensureOpen(): void {
		this.#controller.signal.throwIfAborted();
	}
	#fail(error: unknown): void {
		this.#failure ??= error;
		this.#controller.abort(error);
	}
	#send(bytes: Uint8Array): Promise<void> {
		const copy = Buffer.from(bytes);
		const pending = this.#commands.then(() => {
			this.#ensureOpen();
			this.stdin.push(copy);
		});
		this.#commands = pending.catch(() => {});
		return pending;
	}

	waitFor = <T>(callback: () => T | PromiseLike<T>, options: WaitForOptions = {}): Promise<T> => {
		this.#ensureOpen();
		const signal = AbortSignal.any([
			this.#controller.signal,
			...(options.signal ? [options.signal] : []),
		]);
		return run(() =>
			waitForOperation(
				callback,
				{
					timeoutMs: this.#options.assertionTimeoutMs ?? 4000,
					diagnostics: () => this.screen.getText(),
					subscribe: (notify) => this.#output.observations.subscribe(notify),
				},
				{ ...options, signal },
			),
		);
	};

	/** Own an app's input loop. EOF on disposal ends createUI.main(), including on assertion failure. */
	run(body: () => Promise<void>): void {
		this.#ensureOpen();
		this.#applications.push(
			Promise.resolve()
				.then(body)
				.catch((error) => this.#fail(error)),
		);
	}

	async resize(viewport: Viewport): Promise<void> {
		this.#ensureOpen();
		const size = normalizeViewport(viewport);
		this.#engine.resize(size);
		this.#output.observations.screen(this.#observe());
		Object.assign(this.stdout, size);
		this.stdout.emit('resize');
	}

	[Symbol.asyncDispose] = (): Promise<void> => (this.#closing ??= this.#close());
	async #close(): Promise<void> {
		this.#controller.abort(new SessionClosedError('In-process terminal closed'));
		let deadline: ReturnType<typeof setTimeout> | undefined;
		try {
			await this.#commands;
			this.stdin.push(null);
			await Promise.race([
				Promise.all(this.#applications),
				new Promise<never>((_resolve, reject) => {
					deadline = setTimeout(
						() =>
							reject(
								new GhostwrightError({
									code: 'GW_IN_PROCESS_CLEANUP',
									message: 'Application did not finish after input EOF',
								}),
							),
						1000,
					);
				}),
			]);
			if (this.#failure !== undefined) throw this.#failure;
		} finally {
			clearTimeout(deadline);
			this.stdin.destroy();
			this.stdout.destroy();
			this.#engine.free();
		}
	}
}

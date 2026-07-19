import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname } from 'node:path';
import {
	DenoPermissionError,
	HostCommandTimeoutError,
	ProtocolError,
	SidecarExitedError,
} from '../errors.ts';
import {
	decodeCbor,
	encodeCbor,
	encodeFrame,
	FrameDecoder,
	FrameKind,
	type Frame,
} from './protocol';

export interface SidecarEvents {
	output: (data: Uint8Array, sequence: number) => void;
	exit: (value: { exitCode: number | null; signal: string | null }) => void;
	eof: () => void;
	fatal: (error: Error) => void;
}
type Key = keyof SidecarEvents;
export class SidecarClient {
	#child: ChildProcessWithoutNullStreams;
	#sequence = 1;
	#pending = new Map<
		number,
		{
			kind: FrameKind;
			resolve: (v: any) => void;
			reject: (e: unknown) => void;
			timer: ReturnType<typeof setTimeout>;
			interim?: Record<string, unknown>;
		}
	>();
	#listeners: { [K in Key]: Set<SidecarEvents[K]> } = {
		output: new Set(),
		exit: new Set(),
		eof: new Set(),
		fatal: new Set(),
	};
	#decoder = new FrameDecoder();
	#stderr = '';
	#closed = false;
	#applicationPid?: number;
	#applicationPgid?: number;
	private constructor(
		child: ChildProcessWithoutNullStreams,
		readonly commandTimeoutMs: number,
	) {
		this.#child = child;
		child.stdout.on('data', (b: Buffer) => {
			try {
				for (const f of this.#decoder.push(b)) this.#frame(f);
			} catch (e) {
				this.#fail(e as Error);
			}
		});
		child.stderr.on('data', (b: Buffer) => {
			this.#stderr = (this.#stderr + b.toString()).slice(-8192);
		});
		child.on('exit', (code, signal) => {
			if (!this.#closed)
				this.#fail(new SidecarExitedError(`PTY host exited (${code ?? signal}); ${this.#stderr}`));
		});
		child.on('error', (error) =>
			this.#fail(
				'Deno' in globalThis && /permission|denied|EACCES|requires run access/i.test(error.message)
					? new DenoPermissionError(
							`Deno cannot execute Ghostwright's PTY host. Retry with --allow-read=${dirname(child.spawnfile)} --allow-run=${child.spawnfile}`,
							{ cause: error },
						)
					: new SidecarExitedError(`PTY host failed: ${error.message}`, { cause: error }),
			),
		);
	}
	static async start(path: string, timeoutMs = 5000) {
		const child = spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
		const c = new SidecarClient(child, timeoutMs);
		await c.request(FrameKind.HELLO, { minVersion: 1, maxVersion: 1, clientVersion: '0.1.0' });
		return c;
	}
	on<K extends Key>(key: K, listener: SidecarEvents[K]) {
		this.#listeners[key].add(listener);
		return () => this.#listeners[key].delete(listener);
	}
	#emit<K extends Key>(key: K, ...args: Parameters<SidecarEvents[K]>) {
		for (const f of this.#listeners[key])
			try {
				(f as (...a: any[]) => void)(...args);
			} catch (e) {
				this.#fail(e as Error);
			}
	}
	#frame(f: Frame) {
		if (f.kind === FrameKind.OUTPUT) {
			this.#emit('output', f.payload, f.sequence);
			return;
		}
		if (f.kind === FrameKind.PROCESS_EXIT) {
			this.#emit('exit', decodeCbor(f.payload) as any);
			return;
		}
		if (f.kind === FrameKind.PTY_EOF) {
			this.#emit('eof');
			return;
		}
		if (f.kind === FrameKind.ERROR && f.correlation === 0) {
			const d = decodeCbor(f.payload) as any;
			this.#fail(new ProtocolError(`${d.code}: ${d.message}`));
			return;
		}
		const p = this.#pending.get(f.correlation);
		if (!p) throw new ProtocolError(`Uncorrelated sidecar response ${f.correlation}`);
		if (f.kind === FrameKind.SPAWNED && p.kind === FrameKind.SPAWN) {
			const spawned = decodeCbor(f.payload) as Record<string, unknown>;
			p.interim = spawned;
			this.#applicationPid = spawned.pid as number;
			this.#applicationPgid = spawned.processGroupId as number;
			return;
		}
		clearTimeout(p.timer);
		this.#pending.delete(f.correlation);
		if (f.kind === FrameKind.ERROR) {
			const d = decodeCbor(f.payload) as any;
			p.reject(new ProtocolError(`${d.code}: ${d.message}`));
		} else {
			const response = f.payload.length ? decodeCbor(f.payload) : {};
			p.resolve(
				p.interim ? { ...p.interim, ...(response as object), execPending: false } : response,
			);
		}
	}
	#fail(error: Error) {
		if (this.#closed) return;
		this.#closed = true;
		for (const p of this.#pending.values()) {
			clearTimeout(p.timer);
			p.reject(error);
		}
		this.#pending.clear();
		this.#emit('fatal', error);
		this.#child.kill('SIGKILL');
	}
	request(kind: FrameKind, value?: unknown, raw = false, timeout = this.commandTimeoutMs) {
		if (this.#closed) return Promise.reject(new SidecarExitedError('PTY host is closed'));
		if (this.#sequence === 0xffffffff)
			return Promise.reject(new ProtocolError('Client sequence exhausted'));
		const sequence = this.#sequence++,
			payload = raw
				? (value as Uint8Array)
				: value === undefined
					? new Uint8Array()
					: encodeCbor(value);
		const data = encodeFrame({ kind, sequence, correlation: 0, payload });
		return new Promise<any>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(sequence);
				let fallback = 'not attempted: no trusted application process group';
				if (
					this.#applicationPgid &&
					this.#applicationPid &&
					this.#applicationPgid === this.#applicationPid &&
					this.#applicationPgid > 1
				) {
					try {
						process.kill(-this.#applicationPgid, 'SIGKILL');
						fallback = `sent SIGKILL to process group ${this.#applicationPgid}`;
					} catch (cause) {
						fallback = `process-group fallback failed: ${cause instanceof Error ? cause.message : String(cause)}`;
					}
				}
				const error = new HostCommandTimeoutError(
					`PTY host did not acknowledge command ${kind} sequence ${sequence} within ${timeout} ms; ${fallback}`,
				);
				reject(error);
				this.#fail(error);
			}, timeout);
			this.#pending.set(sequence, { kind, resolve, reject, timer });
			this.#child.stdin.write(data, (e) => {
				if (e) {
					clearTimeout(timer);
					this.#pending.delete(sequence);
					reject(e);
				}
			});
		});
	}
	async spawn(value: unknown) {
		const result = await this.request(FrameKind.SPAWN, value);
		this.#applicationPid = result.pid;
		this.#applicationPgid = result.processGroupId;
		return result;
	}
	write(data: Uint8Array) {
		return this.request(FrameKind.WRITE, data, true);
	}
	resize(value: unknown) {
		return this.request(FrameKind.RESIZE, value);
	}
	signal(value: unknown) {
		return this.request(FrameKind.SIGNAL, value);
	}
	async close(timeout?: number) {
		if (this.#closed) return;
		try {
			await this.request(FrameKind.CLOSE, undefined, false, timeout);
		} finally {
			this.#closed = true;
			this.#child.stdin.end();
		}
	}
	forceKill() {
		this.#closed = true;
		this.#child.kill('SIGKILL');
	}
}

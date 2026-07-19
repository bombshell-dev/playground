import { mkdir, readFile, writeFile } from 'node:fs/promises';
// oxlint-disable-next-line no-restricted-imports -- path module needed for path resolution
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ProcessStatus, ScreenSnapshot, TerminalLaunchOptions } from '../types.ts';
import { TraceWriteError } from '../errors.ts';

export interface TraceEvent {
	schemaVersion: 1;
	sequence: number;
	timestamp: number;
	type: string;
	[key: string]: unknown;
}
/** Records terminal events and optionally persists trace artifacts on failure. */
export class SessionTrace {
	#events: TraceEvent[] = [];
	#seq = 0;
	readonly started = performance.now();
	readonly raw: Uint8Array[] = [];
	readonly options: TerminalLaunchOptions;
	readonly policy: 'off' | 'retain-on-failure' | 'on';
	readonly directory: string;
	constructor(params: {
		options: TerminalLaunchOptions;
		policy: 'off' | 'retain-on-failure' | 'on';
		directory: string;
	}) {
		this.options = params.options;
		this.policy = params.policy;
		this.directory = params.directory;
		this.add('session-start');
	}
	now(): number {
		return performance.now() - this.started;
	}
	events(): TraceEvent[] {
		return [...this.#events];
	}
	add(type: string, data: Record<string, unknown> = {}): void {
		if (this.policy === 'off') return;
		this.#events.push({
			schemaVersion: 1,
			sequence: ++this.#seq,
			timestamp: this.now(),
			type,
			...data,
		});
		if (this.#events.length > 10000) this.#events.shift();
	}
	output(bytes: Uint8Array, frameSequence: number): void {
		if (this.policy === 'off') return;
		const offset = this.raw.reduce((n, b) => n + b.length, 0);
		this.raw.push(bytes.slice());
		this.add('output', {
			frameSequence,
			raw: { offset, length: bytes.length, direction: 'from-pty' },
		});
	}
	// oxlint-disable-next-line max-params -- input needs bytes, action sequence, and redaction flag
	input(bytes: Uint8Array, actionSequence: number, redacted = false): void {
		if (this.policy === 'off') return;
		if (redacted) {
			this.add('input', { actionSequence, redacted: true, length: bytes.length });
			return;
		}
		const offset = this.raw.reduce((total, part) => total + part.length, 0);
		this.raw.push(bytes.slice());
		this.add('input', {
			actionSequence,
			raw: { offset, length: bytes.length, direction: 'to-pty' },
		});
	}
	// oxlint-disable-next-line max-params -- persist needs error, snapshot, and status for artifact writing
	async persist(
		error: unknown,
		snapshot: ScreenSnapshot,
		status: ProcessStatus,
	): Promise<string | undefined> {
		if (this.policy === 'off') return undefined;
		try {
			const name = (this.options.name ?? 'session').replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 60),
				dir = resolve(
					this.directory,
					`${name}-${Date.now()}-${process.pid}-${randomBytes(3).toString('hex')}`,
				);
			await mkdir(dir, { recursive: true, mode: 0o700 });
			const lockUrl = new URL(
					import.meta.url.includes('/dist/') ? '../ghostty.lock.json' : '../../ghostty.lock.json',
					import.meta.url,
				),
				lock = JSON.parse(await readFile(lockUrl, 'utf8')),
				target = `${process.platform}-${process.arch}`,
				hostArtifact = lock.artifacts[`artifacts/pty-host-${target}`],
				wasmArtifact = lock.artifacts['artifacts/ghostty-vt.wasm'],
				redactedIndexes =
					typeof this.options.trace === 'object'
						? new Set(this.options.trace.redactArgumentIndexes ?? [])
						: new Set<number>(),
				deno = (globalThis as unknown as { Deno?: { version: { deno: string } } }).Deno,
				bun = (globalThis as unknown as { Bun?: { version: string } }).Bun,
				metadata = {
					schemaVersion: 1,
					sessionName: name,
					startedAt: new Date().toISOString(),
					runtime: {
						name: deno ? 'deno' : bun ? 'bun' : 'node',
						version: deno ? deno.version.deno : bun ? bun.version : process.version,
					},
					platform: { os: process.platform, arch: process.arch },
					ghostwrightVersion: '0.1.0',
					ghostty: {
						repository: 'https://github.com/ghostty-org/ghostty',
						commit: 'f8041e849b36efbbb9736b6ecf0ccfcb01d94e69',
						wasmSha256: wasmArtifact.sha256,
					},
					ptyHost: { protocolVersion: 1, target, sha256: hostArtifact.sha256 },
					profile: {
						term: 'xterm-ghostty',
						cellWidth: 10,
						cellHeight: 20,
						viewport: snapshot.viewport,
					},
					command: this.options.command,
					args: (this.options.args ?? []).map((argument, index) =>
						redactedIndexes.has(index) ? '<redacted>' : argument,
					),
					cwd: this.options.cwd,
					explicitEnvironmentKeys: Object.keys(this.options.env ?? {}),
					redactedEnvironmentKeys: Object.keys(this.options.env ?? {}).filter((k) =>
						/(password|passwd|secret|token|api[-_]?key|private[-_]?key|credential|auth)/i.test(k),
					),
				};
			const screen = snapshot.lines.map((l) => l.text).join('\n'),
				tens = Array.from({ length: snapshot.viewport.columns }, (_, column) =>
					column % 10 === 0 ? String(Math.floor(column / 10) % 10) : ' ',
				).join(''),
				ones = Array.from({ length: snapshot.viewport.columns }, (_, column) =>
					String(column % 10),
				).join(''),
				finalScreen = `viewport: ${snapshot.viewport.columns}x${snapshot.viewport.rows}\ncursor: (${snapshot.cursor.column},${snapshot.cursor.row}) visible=${snapshot.cursor.visible}\nbuffer: ${snapshot.activeBuffer}\n    ${tens}\n    ${ones}\n${snapshot.lines
					.map((line) => `${String(line.row).padStart(3)} |${line.text}|`)
					.join('\n')}\n`;
			const failure = `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n\nviewport: ${snapshot.viewport.columns}x${snapshot.viewport.rows}\ncursor: (${snapshot.cursor.column},${snapshot.cursor.row}) visible=${snapshot.cursor.visible}\nbuffer: ${snapshot.activeBuffer}\nprocess: ${JSON.stringify(status)}\nartifact path: ${dir}\n\n${screen}\n`;
			await Promise.all([
				writeFile(`${dir}/metadata.json`, JSON.stringify(metadata, null, 2), { mode: 0o600 }),
				writeFile(
					`${dir}/trace.jsonl`,
					this.#events.map((e) => JSON.stringify(e)).join('\n') + '\n',
					{ mode: 0o600 },
				),
				writeFile(`${dir}/output.bin`, Buffer.concat(this.raw.map((b) => Buffer.from(b))), {
					mode: 0o600,
				}),
				writeFile(`${dir}/final-screen.txt`, finalScreen, { mode: 0o600 }),
				writeFile(`${dir}/failure.txt`, failure, { mode: 0o600 }),
			]);
			return dir;
		} catch (cause) {
			throw new TraceWriteError(`Unable to write Ghostwright trace artifacts`, { cause });
		}
	}
}

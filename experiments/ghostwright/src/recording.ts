/* oxlint-disable bombshell-dev/exported-function-async -- Pure frame serialization is synchronous. */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GhostwrightError } from './errors.ts';
import { promisify } from 'node:util';
import type { ScreenSnapshot, CellStyle, TerminalColor } from './types.ts';

import type { TerminalExtensionDefinition, TerminalInteraction } from './types.ts';

export type RecordedInteraction = TerminalInteraction;
export type RecordingEvent =
	| { at: number; kind: 'frame'; screen: ScreenSnapshot }
	| { at: number; kind: 'interaction'; action: RecordedInteraction };
export interface RecordingExportOptions {
	/** Absolute or cwd-relative file prefix, without an extension. */
	path: string;
	formats?: readonly ('gif' | 'mp4')[];
	/** Playback-only spacing. The test itself never sleeps. Zero preserves timing. */
	stepMs?: number;
	agg?: string;
	ffmpeg?: string;
}

/** Bounded, session-local capture of the exact Ghostty cells used by assertions. */
export class LocalRecording implements Disposable {
	readonly #started = performance.now();
	readonly #events: RecordingEvent[] = [];
	#stopped = false;
	constructor(
		initial: ScreenSnapshot,
		private readonly detach: () => void,
		private readonly maxEvents = 2000,
	) {
		this.frame(initial);
	}
	frame(screen: ScreenSnapshot): void {
		this.#append({ at: performance.now() - this.#started, kind: 'frame', screen });
	}
	interaction(action: RecordedInteraction): void {
		this.#append({ at: performance.now() - this.#started, kind: 'interaction', action });
	}
	#append(event: RecordingEvent): void {
		if (this.#stopped) return;
		if (this.#events.length >= this.maxEvents)
			throw new GhostwrightError({
				code: 'GW_RECORDING_LIMIT',
				message: `Local recording exceeded ${this.maxEvents} events; use a smaller component journey`,
			});
		this.#events.push(structuredClone(event));
	}
	stop(): void {
		if (this.#stopped) return;
		this.#stopped = true;
		this.detach();
	}
	[Symbol.dispose](): void {
		this.stop();
	}
	async export(options: RecordingExportOptions): Promise<string[]> {
		this.stop();
		const prefix = fileURLToPath(pathToFileURL(options.path));
		await mkdir(new URL('.', pathToFileURL(prefix)), { recursive: true });
		const trace = `${prefix}.json`;
		const cast = `${prefix}.cast`;
		await writeFile(
			trace,
			JSON.stringify({ version: 1, clock: 'milliseconds', events: this.#events }),
		);
		await writeFile(cast, toAsciicast(this.#events, options.stepMs ?? 450));
		const paths = [trace, cast];
		const formats = options.formats ?? [];
		if (!formats.length) return paths;
		// MP4 goes through the same GIF renderer in this spike. The cast/trace stay
		// available even when an external encoder is missing or fails.
		const gif = `${prefix}.gif`;
		await encode(options.agg ?? process.env.GHOSTWRIGHT_AGG ?? 'agg', [
			'--quiet',
			'--theme',
			'asciinema',
			'--font-size',
			'18',
			'--fps-cap',
			'30',
			'--last-frame-duration',
			'1.5',
			cast,
			gif,
		]);
		paths.push(gif);
		if (formats.includes('mp4')) {
			const mp4 = `${prefix}.mp4`;
			await encode(options.ffmpeg ?? process.env.GHOSTWRIGHT_FFMPEG ?? 'ffmpeg', [
				'-hide_banner',
				'-loglevel',
				'error',
				'-y',
				'-i',
				gif,
				'-vf',
				'fps=30,pad=ceil(iw/2)*2:ceil(ih/2)*2',
				'-c:v',
				'libx264',
				'-pix_fmt',
				'yuv420p',
				'-movflags',
				'+faststart',
				mp4,
			]);
			paths.push(mp4);
		}
		return paths;
	}
}

async function encode(command: string, args: string[]): Promise<void> {
	try {
		await promisify(execFile)(command, args, { timeout: 120_000, maxBuffer: 1024 * 1024 });
	} catch (cause) {
		throw new GhostwrightError({
			code: 'GW_RECORDING_ENCODER',
			message: `Recording encoder ${command} failed. Install agg/FFmpeg or set GHOSTWRIGHT_AGG/GHOSTWRIGHT_FFMPEG. The .cast and .json recording were saved.`,
			cause,
		});
	}
}

/** Standard asciicast v2, with a fixed canvas covering every captured viewport. */
export function toAsciicast(events: readonly RecordingEvent[], stepMs = 450): string {
	if (!Number.isFinite(stepMs) || stepMs < 0)
		throw new GhostwrightError({
			code: 'GW_RECORDING_OPTIONS',
			message: 'stepMs must be nonnegative',
		});
	const screens = events.filter((event) => event.kind === 'frame').map((event) => event.screen);
	const width = Math.max(1, ...screens.map((screen) => screen.viewport.columns));
	const height = Math.max(1, ...screens.map((screen) => screen.viewport.rows));
	const lines = [JSON.stringify({ version: 2, width, height, env: { TERM: 'xterm-256color' } })];
	let offset = 0;
	let lastStep = 0;
	let lastFrame = '';
	for (const event of events) {
		let time = event.at + offset;
		if (event.kind === 'interaction') {
			const added = Math.max(0, lastStep + stepMs - time);
			offset += added;
			time += added;
			lastStep = time;
			lines.push(JSON.stringify([time / 1000, 'm', JSON.stringify(event.action)]));
		} else {
			const frame = snapshotAnsi(event.screen);
			if (frame === lastFrame) continue;
			lastFrame = frame;
			lines.push(JSON.stringify([time / 1000, 'o', frame]));
		}
	}
	return `${lines.join('\n')}\n`;
}

/** Serialize cells, not app state. No application OSC, hyperlinks, or graphics are replayed. */
export function snapshotAnsi(screen: ScreenSnapshot): string {
	let result = '\x1b[?25l\x1b[0m\x1b[2J\x1b[?7l';
	for (const line of screen.lines) {
		let lastStyle = '';
		for (const cell of line.cells) {
			if (cell.continuation) continue;
			const style = sgr(cell.style);
			if (style !== lastStyle) {
				result += style;
				lastStyle = style;
			}
			// Explicit positions preserve wide/combining cell placement across renderers.
			result += `\x1b[${line.row + 1};${cell.column + 1}H${cell.text || ' '}`;
		}
	}
	const cursor = screen.cursor;
	const shape = cursor.shape === 'bar' ? 6 : cursor.shape === 'underline' ? 4 : 2;
	return `${result}\x1b[0m\x1b[${cursor.row + 1};${cursor.column + 1}H\x1b[${shape} q${cursor.visible ? '\x1b[?25h' : ''}`;
}

function sgr(style: CellStyle): string {
	const codes = [0];
	if (style.bold) codes.push(1);
	if (style.faint) codes.push(2);
	if (style.italic) codes.push(3);
	if (style.inverse) codes.push(7);
	if (style.invisible) codes.push(8);
	if (style.strikethrough) codes.push(9);
	if (style.overline) codes.push(53);
	const values = codes.map(String);
	if (style.underline) values.push(`4:${style.underline}`);
	values.push(color(style.foreground, 38), color(style.background, 48));
	if (style.underlineColor && style.underlineColor.kind !== 'default')
		values.push(color(style.underlineColor, 58));
	return `\x1b[${values.join(';')}m`;
}
function color(value: TerminalColor, channel: number): string {
	if (value.kind === 'default') return String(channel + 1);
	if (value.kind === 'palette') return `${channel};5;${value.index}`;
	return `${channel};2;${value.red};${value.green};${value.blue}`;
}

export interface RecordingExtensionOptions extends Omit<RecordingExportOptions, 'path'> {
	output: string;
	enabled?: boolean;
}
export interface RecordingExtension extends TerminalExtensionDefinition, Disposable {
	stop(): void;
	export(): Promise<string[]>;
}

/** Session-owned recording; reuse configuration by creating a fresh extension per session. */
export function recordingExtension(options: RecordingExtensionOptions): RecordingExtension {
	let recording: LocalRecording | undefined;
	let installed = false;
	let exported: Promise<string[]> | undefined;
	const extension: RecordingExtension = {
		id: 'ghostwright/recording',
		setup(context) {
			if (installed)
				throw new GhostwrightError({
					code: 'GW_RECORDING_REUSE',
					message: 'Create a fresh recording extension for each terminal',
				});
			installed = true;
			if (options.enabled === false) return;
			const offFrame = context.onFrame((frame) => recording!.frame(frame));
			const offAction = context.onAction((action) => recording!.interaction(action));
			recording = new LocalRecording(context.current(), () => {
				offFrame();
				offAction();
			});
			return async () => {
				await extension.export();
			};
		},
		stop() {
			recording?.stop();
		},
		[Symbol.dispose]() {
			extension.stop();
		},
		export() {
			if (!installed)
				return Promise.reject(
					new GhostwrightError({
						code: 'GW_RECORDING_UNINSTALLED',
						message: 'Install the recording extension on a terminal before exporting',
					}),
				);
			return (exported ??= recording
				? recording.export({ ...options, path: options.output })
				: Promise.resolve([]));
		},
	};
	return extension;
}

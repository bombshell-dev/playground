import { readFile } from 'node:fs/promises';
// oxlint-disable-next-line no-restricted-imports -- Resolve files within a caller-supplied trace directory.
import { join } from 'node:path';
import { AssetIntegrityError } from '../errors.ts';
import type {
	ScreenRevision,
	ScreenSnapshot,
	TerminalExtensionDefinition,
	Viewport,
} from '../types.ts';
import type { Observation } from '../observations.ts';
import { TerminalOutput } from '../terminal/output.ts';
import { TRACE_SCHEMA_VERSION } from './trace.ts';
import { GhosttyWasmTerminal } from '../terminal/wasm.ts';

export interface ReplayResult {
	readonly revisions: readonly ScreenRevision[];
	readonly observations: readonly Observation[];
	readonly finalSnapshot: ScreenSnapshot;
}
export interface ReplayOptions {
	readonly extensions?: readonly TerminalExtensionDefinition[];
}

/** Replay uses the same byte splitter, pure extension decoders, and pairing pipeline as live capture. */
export async function replayTrace(
	directory: string,
	options: ReplayOptions = {},
): Promise<ReplayResult> {
	const metadata = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'));
	if (metadata.schemaVersion !== TRACE_SCHEMA_VERSION)
		throw new AssetIntegrityError('Unsupported trace schema');
	const lock = JSON.parse(
		await readFile(
			new URL(
				import.meta.url.includes('/dist/') ? '../ghostty.lock.json' : '../../ghostty.lock.json',
				import.meta.url,
			),
			'utf8',
		),
	);
	if (metadata.ghostty?.wasmSha256 !== lock.artifacts['artifacts/ghostty-vt.wasm']?.sha256)
		throw new AssetIntegrityError('Trace Ghostty artifact is incompatible');
	const viewport = metadata.profile?.viewport as Required<Viewport> | undefined;
	if (!viewport) throw new AssetIntegrityError('Trace lacks its initial viewport');
	const extensions = options.extensions ?? [];
	for (const id of metadata.extensions ?? [])
		if (!extensions.some((extension) => extension.id === id))
			throw new AssetIntegrityError(`Replay requires extension decoder ${id}`);
	const raw = new Uint8Array(await readFile(join(directory, 'output.bin')));
	const events = (await readFile(join(directory, 'trace.jsonl'), 'utf8'))
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	if (events[0]?.sequence !== 1)
		throw new AssetIntegrityError('Trace beginning was evicted; replay would be incomplete');
	const engine = await GhosttyWasmTerminal.create(viewport, metadata.graphics?.storageLimitBytes);
	const revisions: ScreenRevision[] = [],
		observations: Observation[] = [];
	let previous = engine.snapshot(),
		sequence = 0,
		sourceFrameSequence = 0,
		timestamp = 0;
	const publish = (cause: ScreenRevision['cause']): ScreenSnapshot => {
		const next = engine.snapshot(cause);
		const observable = (s: ScreenSnapshot): string =>
			JSON.stringify([
				s.lines,
				s.cursor,
				s.viewport,
				s.activeBuffer,
				s.graphics,
				s.modes,
				s.title,
				s.workingDirectory,
			]);
		if (observable(previous) !== observable(next)) {
			const changedRows = next.lines.flatMap((line, row) =>
				JSON.stringify(line) === JSON.stringify(previous.lines[row]) ? [] : [row],
			);
			const visual = (s: ScreenSnapshot): string =>
				JSON.stringify([
					s.lines,
					s.cursor,
					s.viewport,
					s.activeBuffer,
					s.graphics.placements.filter((p) => p.viewport.visible),
				]);
			const visualChange = visual(previous) !== visual(next);
			previous = Object.freeze({
				...next,
				sequence: ++sequence,
				timestamp,
				lastVisualChangeAt: visualChange ? timestamp : previous.lastVisualChangeAt,
			});
			revisions.push(
				Object.freeze({
					sequence,
					timestamp,
					cause,
					sourceFrameSequence,
					changedRows: Object.freeze(changedRows),
					visualChange,
					snapshot: previous,
				}),
			);
		}
		return previous;
	};
	try {
		const output = new TerminalOutput(
			extensions,
			() => previous,
			(bytes) => {
				engine.write(bytes);
				return publish('pty-output');
			},
		);
		output.observations.subscribe((observation) =>
			observations.push(Object.freeze({ ...observation, timestamp })),
		);
		for (const event of events) {
			timestamp = event.timestamp;
			if (event.type === 'output' && event.raw?.direction === 'from-pty') {
				const { offset, length } = event.raw;
				if (
					!Number.isSafeInteger(offset) ||
					!Number.isSafeInteger(length) ||
					offset < 0 ||
					length < 0 ||
					offset + length > raw.length
				)
					throw new AssetIntegrityError('Trace raw range is incomplete');
				sourceFrameSequence = event.frameSequence;
				output.push(raw.slice(offset, offset + length));
				engine.takeEffects(); // Responses are already present in the recorded transport.
			} else if (event.type === 'resize' && event.viewport) {
				engine.resize(event.viewport);
				output.observations.screen(publish('resize'));
			}
		}
		return Object.freeze({
			revisions: Object.freeze(revisions),
			observations: Object.freeze(observations),
			finalSnapshot: previous,
		});
	} finally {
		engine.free();
	}
}

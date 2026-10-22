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
import type { CreateBackend } from '../backend.ts';
import { openBackend } from '../terminal/backend-scope.ts';

export interface ReplayResult {
	readonly revisions: readonly ScreenRevision[];
	readonly observations: readonly Observation[];
	readonly finalSnapshot: ScreenSnapshot;
}
export interface ReplayOptions {
	readonly backend?: CreateBackend;
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
	if (
		metadata.ghostty &&
		metadata.ghostty.wasmSha256 !== lock.artifacts['artifacts/ghostty-vt.wasm']?.sha256
	)
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
	await using owner = await openBackend(
		{ viewport, graphicsStorageLimitBytes: metadata.graphics?.storageLimitBytes },
		{ create: options.backend },
	);
	const engine = owner.backend;
	const identity = metadata.backend ?? { name: 'ghostty', version: metadata.ghostty?.wasmSha256 };
	if (engine.identity.name !== identity.name || engine.identity.version !== identity.version)
		throw new AssetIntegrityError(
			'Trace backend is incompatible; supply the matching backend factory',
		);
	const revisions: ScreenRevision[] = [],
		observations: Observation[] = [];
	let previous = engine.snapshot(),
		sequence = 0,
		sourceFrameSequence = 0,
		timestamp = 0;
	const publish = (next: ScreenSnapshot, cause: ScreenRevision['cause']): ScreenSnapshot => {
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
	const output = new TerminalOutput(
		extensions,
		() => previous,
		(bytes) => {
			// Replay consumes output; returned PTY effects were handled during capture.
			return publish(engine.write(bytes).snapshot, 'pty-output');
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
		} else if (event.type === 'resize' && event.viewport) {
			output.observations.screen(publish(engine.resize(event.viewport).snapshot, 'resize'));
		}
	}
	return Object.freeze({
		revisions: Object.freeze(revisions),
		observations: Object.freeze(observations),
		finalSnapshot: previous,
	});
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AssetIntegrityError } from '../errors.ts';
import type { ScreenRevision, ScreenSnapshot, Viewport } from '../types.ts';
import { GhosttyWasmTerminal } from '../terminal/wasm.ts';

export interface ReplayResult {
	revisions: readonly ScreenRevision[];
	finalSnapshot: ScreenSnapshot;
}

function observable(snapshot: ScreenSnapshot) {
	return JSON.stringify({
		viewport: snapshot.viewport,
		activeBuffer: snapshot.activeBuffer,
		cursor: snapshot.cursor,
		lines: snapshot.lines,
		modes: snapshot.modes,
		title: snapshot.title,
		workingDirectory: snapshot.workingDirectory,
	});
}

export async function replayTrace(directory: string): Promise<ReplayResult> {
	const metadata = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'));
	if (metadata.schemaVersion !== 1)
		throw new AssetIntegrityError(`Unsupported Ghostwright trace schema ${metadata.schemaVersion}`);
	const lockUrl = new URL(
			import.meta.url.includes('/dist/') ? '../ghostty.lock.json' : '../../ghostty.lock.json',
			import.meta.url,
		),
		lock = JSON.parse(await readFile(lockUrl, 'utf8')),
		expectedWasm = lock.artifacts['artifacts/ghostty-vt.wasm']?.sha256;
	if (!expectedWasm || metadata.ghostty?.wasmSha256 !== expectedWasm)
		throw new AssetIntegrityError('Trace Ghostty artifact is incompatible with this package');
	const viewport = metadata.profile?.viewport as Required<Viewport> | undefined;
	if (!viewport)
		throw new AssetIntegrityError('Trace metadata does not contain the initial viewport');
	const raw = new Uint8Array(await readFile(join(directory, 'output.bin'))),
		events = (await readFile(join(directory, 'trace.jsonl'), 'utf8'))
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line)),
		terminal = await GhosttyWasmTerminal.create(viewport),
		revisions: ScreenRevision[] = [];
	let previous = terminal.snapshot(),
		sequence = 0;
	try {
		for (const event of events) {
			let cause: 'pty-output' | 'resize' | undefined;
			if (event.type === 'output' && event.raw?.direction === 'from-pty') {
				terminal.write(raw.slice(event.raw.offset, event.raw.offset + event.raw.length));
				cause = 'pty-output';
			} else if (event.type === 'action' && event.viewport) {
				terminal.resize(event.viewport);
				cause = 'resize';
			}
			if (!cause) continue;
			const snapshot = terminal.snapshot(cause);
			if (observable(snapshot) === observable(previous)) continue;
			sequence++;
			const changedRows = snapshot.lines
				.map((line, row) =>
					JSON.stringify(line) === JSON.stringify(previous.lines[row]) ? -1 : row,
				)
				.filter((row) => row >= 0);
			const visualChange =
				JSON.stringify([
					snapshot.lines,
					snapshot.cursor,
					snapshot.activeBuffer,
					snapshot.viewport,
				]) !==
				JSON.stringify([previous.lines, previous.cursor, previous.activeBuffer, previous.viewport]);
			const sequenced = Object.freeze({ ...snapshot, sequence });
			revisions.push(
				Object.freeze({
					sequence,
					timestamp: event.timestamp,
					cause,
					sourceFrameSequence: event.frameSequence,
					changedRows: Object.freeze(changedRows),
					visualChange,
					snapshot: sequenced,
				}),
			);
			previous = sequenced;
		}
		return { revisions: Object.freeze(revisions), finalSnapshot: previous };
	} finally {
		terminal.free();
	}
}

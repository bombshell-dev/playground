// oxlint-disable bombshell-dev/exported-function-async -- this spike exposes pure synchronous readers
import type {
	AsyncLocator,
	AsyncRegion,
	AsyncTerminal,
	Rect,
	ScreenCell,
	TextLocatorOptions,
} from 'ghostwright';

const OSC = 7777,
	NAMESPACE = 'ghostwright.clay',
	PREFIX = `\u001b]${OSC};${NAMESPACE};v=`;

export interface ClayElementMetadata {
	id: string;
	rect: [x: number, y: number, width: number, height: number];
}

export interface ClayFrameMetadata {
	version: number;
	frame: number;
	mode?: string;
	renderSurface?: { width: number; height: number; row: number };
	elements: ClayElementMetadata[];
}

/** Protocol or geometry error reported by the experimental Clay extension. */
export class ClayMetadataError extends Error {
	readonly code = 'CLAY_METADATA';
}

function asRect([x, y, width, height]: ClayElementMetadata['rect']): Rect {
	if (![x, y, width, height].every(Number.isFinite))
		throw new ClayMetadataError('Clay metadata rectangle must contain finite numbers');
	return {
		column: Math.floor(x),
		row: Math.floor(y),
		width: Math.ceil(width),
		height: Math.ceil(height),
	};
}

/**
 * Streaming-safe in production because it parses the accumulated raw byte
 * stream rather than assuming one OSC per PTY read. For the spike, reparsing is
 * intentionally simple; an actual extension would maintain an incremental
 * parser and attach completed frames to screen revisions.
 */
export function parseClayFrames(bytes: Uint8Array): ClayFrameMetadata[] {
	const raw = Buffer.from(bytes).toString('latin1'),
		frames: ClayFrameMetadata[] = [];
	let offset = 0;
	for (;;) {
		const start = raw.indexOf(PREFIX, offset);
		if (start < 0) break;
		const bodyStart = start + PREFIX.length,
			st = raw.indexOf('\u001b\\', bodyStart),
			bel = raw.indexOf('\u0007', bodyStart),
			end = st < 0 ? bel : bel < 0 ? st : Math.min(st, bel);
		if (end < 0) break; // Incomplete OSC at the end of the accumulated stream.
		const body = raw.slice(bodyStart, end),
			separator = body.indexOf(';');
		if (separator > 0) {
			const envelopeVersion = Number(body.slice(0, separator)),
				payload = body.slice(separator + 1);
			try {
				const frame = JSON.parse(
					Buffer.from(payload, 'base64url').toString('utf8'),
				) as ClayFrameMetadata;
				if (frame.version === envelopeVersion && Array.isArray(frame.elements)) frames.push(frame);
			} catch {
				// Ignore malformed extension data. A production extension should retain
				// a protocol diagnostic and expose it with test failures.
			}
		}
		offset = end + (end === st ? 2 : 1);
	}
	return frames;
}

/** ID-based element locator contributed by the experimental Clay extension. */
export class ClayElementLocator {
	constructor(
		readonly terminal: AsyncTerminal,
		readonly metadata: ClayElementMetadata,
	) {}

	get id(): string {
		return this.metadata.id;
	}

	get bounds(): Rect {
		return asRect(this.metadata.rect);
	}

	region(): AsyncRegion {
		return this.terminal.region(this.bounds);
	}

	getByText(text: string, options?: TextLocatorOptions): AsyncLocator {
		return this.region().getByText(text, options);
	}

	cells(): readonly ScreenCell[] {
		return this.terminal.screen.getCells(this.bounds);
	}
}

/** Minimal stand-in for a future Ghostwright extension instance. */
export class ClayMetadataExtension {
	constructor(readonly terminal: AsyncTerminal) {}

	frames(): readonly ClayFrameMetadata[] {
		return parseClayFrames(this.terminal.screen.rawOutput());
	}

	current(): ClayFrameMetadata | undefined {
		return this.frames().at(-1);
	}

	getById(id: string): ClayElementLocator | undefined {
		const metadata = this.current()?.elements.find((element) => element.id === id);
		return metadata ? new ClayElementLocator(this.terminal, metadata) : undefined;
	}
}

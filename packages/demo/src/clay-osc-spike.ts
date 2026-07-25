import { close, createTerm, fixed, grow, open, rgba, text } from '@bomb.sh/tty';
import { stdout } from 'node:process';

/**
 * Experimental protocol number for the spike only. This is not a proposed
 * permanent OSC allocation.
 */
const OSC = 7777,
	NAMESPACE = 'ghostwright.clay',
	VERSION = 1;

interface ClayElementMetadata {
	id: string;
	rect: [x: number, y: number, width: number, height: number];
}

interface ClayFrameMetadata {
	version: number;
	frame: number;
	elements: ClayElementMetadata[];
}

class ClayOscSpikeError extends Error {
	readonly code = 'CLAY_OSC_SPIKE';
}

function encodeMetadata(frame: ClayFrameMetadata): Uint8Array {
	const payload = Buffer.from(JSON.stringify(frame)).toString('base64url');
	return Buffer.from(`\u001b]${OSC};${NAMESPACE};v=${VERSION};${payload}\u001b\\`);
}

const width = stdout.columns || 60,
	height = stdout.rows || 15,
	term = await createTerm({ width, height }),
	result = term.render([
		open('screen', {
			layout: { width: grow(), height: grow(), alignX: 'center', alignY: 'center' },
		}),
		open('semantic-target', {
			border: {
				color: rgba(255, 255, 255),
				top: 1,
				right: 1,
				bottom: 1,
				left: 1,
			},
			layout: {
				width: fixed(30),
				height: fixed(5),
				padding: { top: 1, right: 1, bottom: 1, left: 1 },
			},
		}),
		text('Clay semantic target'),
		close(),
		close(),
	]),
	info = result.info.get('semantic-target');

if (!info) throw new ClayOscSpikeError('Clay did not retain the semantic-target element');

const metadata: ClayFrameMetadata = {
	version: VERSION,
	frame: 1,
	elements: [
		{
			id: 'semantic-target',
			rect: [info.bounds.x, info.bounds.y, info.bounds.width, info.bounds.height],
		},
	],
};

// Keep visual bytes and their metadata adjacent in one logical stdout write.
// A streaming receiver must still tolerate the PTY splitting or coalescing it.
stdout.write(Buffer.concat([Buffer.from(result.output), Buffer.from(encodeMetadata(metadata))]));

// Stay alive like a real TUI; Ghostwright owns cleanup of the process group.
await new Promise(() => {});

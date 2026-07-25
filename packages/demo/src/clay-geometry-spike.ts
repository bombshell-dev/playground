import { close, createTerm, fixed, grow, open, rgba, text, type Op } from '@bomb.sh/tty';
import { stdout } from 'node:process';

const mode = process.argv[2] ?? 'offset';

interface ElementMetadata {
	id: string;
	rect: [x: number, y: number, width: number, height: number];
}

class GeometrySpikeError extends Error {
	readonly code = 'CLAY_GEOMETRY_SPIKE';
}

function osc(payload: unknown): Uint8Array {
	const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return Buffer.from(`\u001b]7777;ghostwright.clay;v=1;${encoded}\u001b\\`);
}

function metadata(
	info: {
		get(
			id: string,
		): { bounds: { x: number; y: number; width: number; height: number } } | undefined;
	},
	ids: string[],
): ElementMetadata[] {
	return ids.map((id) => {
		const element = info.get(id);
		if (!element) throw new GeometrySpikeError(`Clay did not retain ${id}`);
		const { x, y, width, height } = element.bounds;
		return { id, rect: [x, y, width, height] };
	});
}

let width: number,
	height: number,
	renderRow = 1,
	ids: string[],
	ops: Op[];

switch (mode) {
	case 'offset':
		width = 20;
		height = 5;
		renderRow = 6;
		ids = ['offset-target'];
		ops = [
			open('root', {
				layout: { width: grow(), height: grow(), alignX: 'center', alignY: 'center' },
			}),
			open('offset-target', {
				border: { color: rgba(255, 255, 255), top: 1, right: 1, bottom: 1, left: 1 },
				layout: {
					width: fixed(10),
					height: fixed(3),
					padding: { left: 1, right: 1 },
				},
			}),
			text('Offset'),
			close(),
			close(),
		];
		break;
	case 'fractional':
		width = 20;
		height = 10;
		ids = ['fractional-target'];
		ops = [
			open('root', {
				layout: { width: grow(), height: grow(), alignX: 'center', alignY: 'center' },
			}),
			open('fractional-target', {
				bg: rgba(0, 255, 0),
				layout: { width: fixed(5), height: fixed(3) },
			}),
			close(),
			close(),
		];
		break;
	case 'clipped':
		width = 30;
		height = 10;
		ids = ['clipper', 'oversized-target'];
		ops = [
			open('root', {
				layout: { width: grow(), height: grow(), alignX: 'center', alignY: 'center' },
			}),
			open('clipper', {
				clip: { horizontal: true, vertical: true },
				layout: { width: fixed(12), height: fixed(5) },
			}),
			open('oversized-target', {
				bg: rgba(255, 0, 0),
				layout: { width: fixed(20), height: fixed(7) },
			}),
			close(),
			close(),
			close(),
		];
		break;
	case 'offscreen':
		width = 30;
		height = 10;
		ids = ['offscreen-target'];
		ops = [
			open('root', {
				layout: { width: grow(), height: grow(), alignX: 'center', alignY: 'center' },
			}),
			open('offscreen-target', {
				bg: rgba(0, 0, 255),
				floating: {
					x: -5,
					y: 3.5,
					attachTo: 'root',
					attachPoints: { element: 'left-top', parent: 'left-top' },
					zIndex: 1,
				},
				layout: { width: fixed(40), height: fixed(3) },
			}),
			close(),
			close(),
		];
		break;
	default:
		throw new GeometrySpikeError(`Unknown geometry mode ${JSON.stringify(mode)}`);
}

const term = await createTerm({ width, height }),
	result = term.render(ops, { row: renderRow }),
	frame = {
		version: 1,
		frame: 1,
		mode,
		renderSurface: { width, height, row: renderRow },
		elements: metadata(result.info, ids),
	};

// Metadata describes the following visual bytes. This remains correct when the
// PTY splits the logical write into multiple host frames.
stdout.write(Buffer.concat([Buffer.from(osc(frame)), Buffer.from(result.output)]));
await new Promise(() => {});

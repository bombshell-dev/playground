// Acceptance tests: the capability-map wiring in isolation, and the demo
// stylesheet's @media / light-dark behavior through the real CSS engine.
import { describe, expect, it } from 'vitest';
import { compile, computeTree, NO_PARENT } from '@bomb.sh/css';
import type { Rgb, RuntimeCapabilities } from '@bomb.sh/tty';
import {
	capabilityVariables,
	colorSchemeOf,
	environmentFromCapabilities,
	CELL_HEIGHT_PX,
	CELL_WIDTH_PX,
} from '../src/index.ts';
import { createDemoDocument, NODE_STATE, snapshotDocument } from '../src/tree.ts';
import { DEMO_CSS } from '../src/styles.ts';

/// A baseline `term.capabilities` snapshot: the 256-color static defaults
/// plus the empty merged view a term has before any probe responses fold
/// in.
const caps = (over: Partial<RuntimeCapabilities> = {}): RuntimeCapabilities => ({
	colors: 256,
	trueColor: false,
	bce: true,
	autoMargin: true,
	xenl: true,
	altScreen: true,
	styledUnderline: false,
	syncOutput: false,
	pointerShape: false,
	kittyKeyboard: false,
	kittyGraphics: false,
	theme: {},
	...over,
});

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const NEAR_BLACK: Rgb = { r: 30, g: 30, b: 40 };

const rootDeclarations = (computed: [string, string][][]): Map<string, string> =>
	new Map(computed[0]);

describe('capability map wiring', () => {
	it('derives the color scheme from the probed background', () => {
		expect(colorSchemeOf(WHITE)).toBe('light');
		expect(colorSchemeOf(NEAR_BLACK)).toBe('dark');
		expect(colorSchemeOf(undefined)).toBeUndefined();
	});

	it('maps cell metrics and scheme into the environment', () => {
		const env = environmentFromCapabilities(caps({ theme: { background: WHITE } }), {
			size: { columns: 80, rows: 24 },
			reducedMotion: true,
		});
		expect(env.viewportWidth).toBe(80 * CELL_WIDTH_PX);
		expect(env.viewportHeight).toBe(24 * CELL_HEIGHT_PX);
		expect(env.colorScheme).toBe('light');
		expect(env.reducedMotion).toBe(true);
		expect(env.resolution).toBe(1);
	});

	it('falls back to a host-chosen scheme when the probe never answers', () => {
		const defaults = environmentFromCapabilities(caps(), { size: { columns: 80, rows: 24 } });
		expect(defaults.colorScheme).toBe('dark');
		const forced = environmentFromCapabilities(caps(), {
			size: { columns: 80, rows: 24 },
			fallbackColorScheme: 'light',
		});
		expect(forced.colorScheme).toBe('light');
	});

	it('exposes depth facts as root custom properties', () => {
		expect(capabilityVariables(caps())).toBe('--tty-colors: 256');
		expect(capabilityVariables(caps({ trueColor: true }))).toBe(
			'--tty-colors: 256; --tty-truecolor: 1',
		);
	});
});

describe('document snapshot', () => {
	it('snapshots into the flat node/parent form', () => {
		const { nodes, parents } = snapshotDocument(createDemoDocument(), {
			rootStyle: '--tty-colors: 256',
			viewport: { columns: 80, rows: 24 },
		});
		expect(parents[0]).toBe(NO_PARENT);
		expect(parents[1]).toBe(0);
		expect(nodes[0]!.tag).toBe('box');
		expect(nodes[0]!.id).toBe('app');
		expect(nodes[0]!.style).toBe('--tty-colors: 256');
		expect(nodes[0]!.width).toBe(80 * CELL_WIDTH_PX);
		expect(nodes[0]!.height).toBe(24 * CELL_HEIGHT_PX);
		// Document order: app, header, title, status, board, then each
		// card with its heading and body, then the status bar's readout.
		expect(nodes.map((node) => node.classes?.[0])).toEqual([
			'app',
			'header',
			'title',
			'status',
			'board',
			'card',
			'heading',
			'body',
			'card',
			'heading',
			'body',
			'card',
			'heading',
			'body',
			'statusbar',
			'numbers',
		]);
	});

	it('marks the focused element in the state bits', () => {
		const document = createDemoDocument();
		const firstCard = document.documentElement!.children[1]!.children[0]!;
		firstCard.focus();
		const { nodes } = snapshotDocument(document);
		const focused = nodes.findIndex((node) => node.state === NODE_STATE.focus);
		expect(focused).toBe(5);
	});
});

describe('demo stylesheet through the engine', () => {
	const style = ({
		columns,
		rows,
		background,
	}: {
		columns: number;
		rows: number;
		background?: Rgb;
	}) => {
		const capabilities = caps(background ? { theme: { background } } : {});
		const size = { columns, rows };
		const { nodes, parents } = snapshotDocument(createDemoDocument(), {
			rootStyle: capabilityVariables(capabilities),
			viewport: size,
		});
		const env = environmentFromCapabilities(capabilities, { size });
		return computeTree(compile(DEMO_CSS, 2), { nodes, parents, env });
	};

	it('compiles without diagnostics', () => {
		expect(compile(DEMO_CSS, 2).diagnostics).toEqual([]);
	});

	it('flips the layout across the 80ch breakpoint', () => {
		// 40×25: 320×400px — narrow and portrait.
		const narrow = rootDeclarations(style({ columns: 40, rows: 25 }));
		expect(narrow.get('--columns')).toBe('1');
		expect(narrow.get('--axis')).toBe('column');
		// 80×24: 640×384px — exactly the 80ch breakpoint, landscape.
		const wide = rootDeclarations(style({ columns: 80, rows: 24 }));
		expect(wide.get('--columns')).toBe('2');
		expect(wide.get('--axis')).toBe('row');
	});

	it('honors the host reduced-motion switch', () => {
		const size = { columns: 80, rows: 24 };
		const { nodes, parents } = snapshotDocument(createDemoDocument(), {
			viewport: size,
		});
		const env = environmentFromCapabilities(caps(), { size, reducedMotion: true });
		const computed = computeTree(compile(DEMO_CSS, 2), { nodes, parents, env });
		expect(rootDeclarations(computed).get('--motion')).toBe('none');
	});

	it('resolves light-dark() against the probed scheme', () => {
		// .card's color is var(--fg), and --fg is light-dark(...): the dark
		// probed background picks the dark branch. The card is node 5; its
		// heading (node 6) resolves var(--accent) instead.
		const dark = style({ columns: 80, rows: 24, background: NEAR_BLACK });
		expect(dark[5]).toContainEqual(['color', '#e2e2e8']);
		const light = style({ columns: 80, rows: 24, background: WHITE });
		expect(light[5]).toContainEqual(['color', '#1b1b22']);
	});

	it('changes the accent color across the 80ch breakpoint', () => {
		// The wide breakpoint hands the accent from amber to violet — this
		// is what makes the rendered demo change colors on resize.
		const narrow = style({ columns: 40, rows: 25, background: NEAR_BLACK });
		expect(narrow[6]).toContainEqual(['color', '#f59e0b']);
		const wide = style({ columns: 80, rows: 24, background: NEAR_BLACK });
		expect(wide[6]).toContainEqual(['color', '#8b5cf6']);
		const wideLight = style({ columns: 80, rows: 24, background: WHITE });
		expect(wideLight[6]).toContainEqual(['color', '#6d28d9']);
	});

	it('drops malformed inline light-dark() at computed-value time', () => {
		const size = { columns: 80, rows: 24 };
		const { nodes, parents } = snapshotDocument(createDemoDocument(), {
			viewport: size,
		});
		nodes[0]!.style = `${nodes[0]!.style}; color: light-dark(#fff)`;
		const env = environmentFromCapabilities(caps(), { size });
		const computed = computeTree(compile(DEMO_CSS, 2), { nodes, parents, env });
		expect(rootDeclarations(computed).has('color')).toBe(false);
	});
});

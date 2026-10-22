// Adapter: wire `@bomb.sh/tty` capability maps into `@bomb.sh/css`.
//
// Two paths carry terminal capabilities into a stylesheet:
//
// 1. `environmentFromCapabilities` builds the `env` record handed to
//    `computeTree({ env })`. `@media` evaluation reads it: terminal size
//    becomes the viewport, the probed background color becomes
//    `prefers-color-scheme`, and `prefers-reduced-motion` comes from a host
//    switch (terminals expose none).
// 2. `capabilityVariables` renders capability facts that have no
//    environment slot (color depth, kitty protocols) as root custom
//    properties, consumable with `var()` through the root's inline style.
//
// The capability map itself is `term.capabilities` — the merged view
// `@bomb.sh/tty` maintains when `scan()` events flow through
// `term.update()`. Nothing is folded here.
import type { Rgb, RuntimeCapabilities } from '@bomb.sh/tty';
import type { Environment } from '@bomb.sh/css';

/// One terminal cell is 8×16 CSS px. The width matches the engine's `ch`
/// unit (1ch = 8px), so `@media (min-width: 80ch)` selects an 80-column
/// terminal; the 16px cell makes `em`-based queries (16px root) read as
/// lines.
export const CELL_WIDTH_PX = 8;
export const CELL_HEIGHT_PX = 16;

export interface TerminalSize {
	columns: number;
	rows: number;
}

/// WCAG relative luminance of an 8-bit sRGB color.
export function relativeLuminance({ r, g, b }: Rgb): number {
	const channel = (component: number): number => {
		const srgb = component / 255;
		return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/// `prefers-color-scheme` from the probed background color: `light` when the
/// terminal paints a bright background, `dark` otherwise. `undefined` when
/// the terminal never answered the probe — the caller chooses the fallback.
export function colorSchemeOf(background: Rgb | undefined): 'light' | 'dark' | undefined {
	if (background === undefined) {
		return undefined;
	}
	return relativeLuminance(background) >= 0.5 ? 'light' : 'dark';
}

export interface EnvironmentOptions {
	/// Terminal size in cells; becomes the viewport at 8×16px per cell.
	size: TerminalSize;
	/// Used when the terminal did not answer the background-color probe.
	/// Defaults to `dark`, the usual terminal default.
	fallbackColorScheme?: 'light' | 'dark';
	/// The host's motion switch; terminals expose no such capability.
	reducedMotion?: boolean;
}

/// The capability map → env wiring for `computeTree({ env })`.
export function environmentFromCapabilities(
	capabilities: RuntimeCapabilities,
	options: EnvironmentOptions,
): Environment {
	const { size } = options;
	return {
		viewportWidth: size.columns * CELL_WIDTH_PX,
		viewportHeight: size.rows * CELL_HEIGHT_PX,
		colorScheme:
			colorSchemeOf(capabilities.theme.background) ?? options.fallbackColorScheme ?? 'dark',
		reducedMotion: options.reducedMotion ?? false,
		// Terminals are one device pixel per cell.
		resolution: 1,
	};
}

/// Capability facts without an environment slot reach CSS through root
/// custom properties: put the returned string in the root node's inline
/// `style` and consume the values with `var()`.
export function capabilityVariables(capabilities: RuntimeCapabilities): string {
	const declarations = [`--tty-colors: ${capabilities.colors}`];
	if (capabilities.trueColor) {
		declarations.push('--tty-truecolor: 1');
	}
	if (capabilities.kittyGraphics) {
		declarations.push('--tty-kitty-graphics: 1');
	}
	return declarations.join('; ');
}

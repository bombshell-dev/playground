export const FREEDOM_TTY_OSC = 7777;
export const FREEDOM_TTY_NAMESPACE = 'ghostwright.freedom-tty';
export const FREEDOM_TTY_VERSION = 1;

export interface FloatRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}
export interface Rect {
	readonly column: number;
	readonly row: number;
	readonly width: number;
	readonly height: number;
}
export type JsonScalar = string | number | boolean | null;

export interface FreedomTtyNodeV1 {
	readonly key: string;
	readonly name: string;
	readonly parent: string | null;
	readonly order: number;
	readonly attributes: Readonly<{
		role?: string;
		label?: string;
		input?: boolean;
		focusable: boolean;
		custom?: Readonly<Record<string, JsonScalar>>;
	}>;
	readonly states: Readonly<{ focused: boolean; focusRoot: boolean }>;
	readonly geometry?: Readonly<{
		layoutBounds: FloatRect;
		terminalBounds: Rect;
		visibleBounds?: Rect;
	}>;
}

export interface FreedomTtyFrameV1 {
	readonly version: 1;
	readonly frame: number;
	readonly renderSurface: Readonly<{ columns: number; rows: number; row: number }>;
	readonly focusStack: readonly string[];
	readonly nodes: readonly FreedomTtyNodeV1[];
}

export function encodeFreedomTtyFrame(frame: FreedomTtyFrameV1): Uint8Array {
	const payload = Buffer.from(JSON.stringify(frame)).toString('base64url');
	return Buffer.from(`\u001b]${FREEDOM_TTY_OSC};${FREEDOM_TTY_NAMESPACE};v=1;${payload}\u001b\\`);
}

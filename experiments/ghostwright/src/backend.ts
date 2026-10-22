import type { Operation } from 'effection';
import type {
	KeyName,
	KeyPress,
	KittyImageSnapshot,
	MouseOptions,
	Point,
	ScreenLine,
	ScreenSnapshot,
	Viewport,
} from './types.ts';

export interface BackendOptions {
	readonly viewport: Required<Viewport>;
	readonly graphicsStorageLimitBytes?: number;
}

/** Identifies emulator behavior for trace replay, including its build/version. */
export interface BackendIdentity {
	readonly name: string;
	readonly version: string;
}

export type TerminalEffect =
	| { type: 'write-pty'; data: Uint8Array }
	| { type: 'bell' }
	| { type: 'title' }
	| { type: 'working-directory' }
	| { type: 'clipboard-write'; data: string };

export interface BackendUpdate {
	readonly snapshot: ScreenSnapshot;
	readonly effects: readonly TerminalEffect[];
}

export interface BackendHistoryRow {
	readonly line: ScreenLine;
	readonly kittyVirtualPlaceholder: boolean;
}

/**
 * One session's emulator. These functions must remain synchronous: output and
 * its snapshot form one indivisible observation at a registered OSC boundary.
 * Snapshots are detached immutable evidence; effects never perform transport I/O.
 * Unsupported graphics are explicit in snapshot.graphics.supported.
 */
export interface TerminalBackend {
	readonly identity: BackendIdentity;
	write(bytes: Uint8Array): BackendUpdate;
	resize(viewport: Required<Viewport>): BackendUpdate;
	snapshot(): ScreenSnapshot;
	encodeKey(key: KeyName | KeyPress): Uint8Array;
	encodeMouse(
		action: 'move' | 'down' | 'up',
		point: Point,
		options?: MouseOptions,
		anyButtonPressed?: boolean,
	): Uint8Array;
	encodePaste(text: string): Uint8Array;
	encodeFocus(state: 'in' | 'out'): Uint8Array;
	scrollbackRows(): number;
	history(start: number, count: number): readonly BackendHistoryRow[];
	clipboard(): string;
	inspectImage(id: number): KittyImageSnapshot | undefined;
	copyImageData(id: number): Uint8Array | undefined;
	cachedImage(id: number): KittyImageSnapshot | undefined;
}

/** Acquire fresh state and register its release in the caller's Effection scope. */
export type CreateBackend = (options: BackendOptions) => Operation<TerminalBackend>;

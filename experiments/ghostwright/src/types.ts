import type { Operation } from 'effection';

export interface Viewport {
	columns: number;
	rows: number;
	widthPixels?: number;
	heightPixels?: number;
}
export interface CleanupOptions {
	hangupGraceMs?: number;
	terminateGraceMs?: number;
	postExitDrainMs?: number;
}
export interface HistoryOptions {
	maxRevisions?: number;
	maxRawBytes?: number;
	maxDecodedBytes?: number;
}
/** Per-active-screen Kitty image storage configuration. */
export interface GraphicsOptions {
	/** Decoded-image storage cap in bytes. Defaults to 64 MiB; zero disables storage. */
	storageLimitBytes?: number;
}
export type TracePolicy = 'off' | 'retain-on-failure' | 'on';
export interface TraceOptions {
	policy?: TracePolicy;
	directory?: string;
	redactArgumentIndexes?: readonly number[];
}
export interface TerminalLaunchOptions {
	command: string;
	args?: readonly string[];
	cwd?: string;
	env?: Readonly<Record<string, string>>;
	viewport?: Viewport;
	commandTimeoutMs?: number;
	assertionTimeoutMs?: number;
	settleMs?: number;
	cleanup?: CleanupOptions;
	history?: HistoryOptions;
	graphics?: GraphicsOptions;
	trace?: TracePolicy | TraceOptions;
	name?: string;
}
export interface Point {
	column: number;
	row: number;
}
export interface Rect extends Point {
	width: number;
	height: number;
}
export interface ActionReceipt {
	actionSequence: number;
	screenSequenceBefore: number;
	acknowledgedAt: number;
	deliveredToChild: boolean;
	bytesWritten: number;
}
export type KeyName =
	| 'Enter'
	| 'Tab'
	| 'Escape'
	| 'Backspace'
	| 'Delete'
	| 'ArrowUp'
	| 'ArrowDown'
	| 'ArrowLeft'
	| 'ArrowRight'
	| 'Home'
	| 'End'
	| 'PageUp'
	| 'PageDown'
	| `F${number}`
	| string;
export interface KeyPress {
	key: KeyName;
	shift?: boolean;
	control?: boolean;
	alt?: boolean;
	super?: boolean;
}
export interface TraceableInputOptions {
	trace?: 'record' | 'redact';
}
export interface MouseOptions {
	button?: 'left' | 'middle' | 'right' | number;
	shift?: boolean;
	control?: boolean;
	alt?: boolean;
	super?: boolean;
}
export interface WheelOptions extends Point {
	deltaRows: number;
	deltaColumns?: number;
}
export interface AssertionOptions {
	timeoutMs?: number;
}
export interface StableAssertionOptions extends AssertionOptions {
	settleMs?: number;
}
export interface TransientAssertionOptions extends AssertionOptions {
	since?: ActionReceipt | number;
}
export interface TextLocatorOptions {
	exact?: boolean;
}
export interface LocatorMatch {
	text: string;
	range: Rect;
	rowText: string;
}
export interface ProcessStatus {
	state: 'starting' | 'running' | 'exited' | 'closed' | 'failed';
	pid?: number;
	processGroupId?: number;
	exitCode?: number | null;
	signal?: string | null;
	ptyEof: boolean;
}
export type TerminalColor =
	| { kind: 'default' }
	| { kind: 'palette'; index: number }
	| { kind: 'rgb'; red: number; green: number; blue: number };
export interface CellStyle {
	bold: boolean;
	italic: boolean;
	faint: boolean;
	blink: boolean;
	inverse: boolean;
	invisible: boolean;
	strikethrough: boolean;
	overline: boolean;
	underline: number;
	foreground: TerminalColor;
	background: TerminalColor;
	underlineColor?: TerminalColor;
}
export interface ScreenCell {
	column: number;
	text: string;
	width: 0 | 1 | 2;
	continuation: boolean;
	style: CellStyle;
	selected: boolean;
	hyperlink?: string;
}
export interface ScreenLine {
	row: number;
	cells: readonly ScreenCell[];
	wrapped: boolean;
	text: string;
}
export interface CursorSnapshot extends Point {
	visible: boolean;
	shape: 'block' | 'bar' | 'underline';
	blinking: boolean;
}
export interface TerminalModes {
	applicationCursorKeys: boolean;
	backarrowSendsBackspace: boolean;
	bracketedPaste: boolean;
	focusReporting: boolean;
	mouseTracking: 'none' | 'x10' | 'normal' | 'button' | 'any';
	mouseFormat: 'x10' | 'utf8' | 'sgr' | 'urxvt' | 'sgr-pixels';
	kittyKeyboardFlags: number;
	alternateScreen: boolean;
	privateModes: Readonly<Record<number, boolean>>;
}
export interface KittyImageSnapshot {
	id: number;
	number: number;
	generation: string;
	width: number;
	height: number;
	format: 'rgb' | 'rgba' | 'gray' | 'gray-alpha';
	compression: 'none';
	dataLength: number;
	sha256: string;
}
export interface KittyPlacementSnapshot {
	imageId: number;
	placementId: number;
	imageGeneration: string;
	image?: KittyImageSnapshot;
	virtual: boolean;
	z: number;
	layer: 'below-background' | 'below-text' | 'above-text';
	offset: { xPixels: number; yPixels: number };
	requestedGrid: { columns: number; rows: number };
	renderedGrid?: { columns: number; rows: number };
	renderedPixels?: { width: number; height: number };
	viewport: { column?: number; row?: number; visible: boolean };
	source: { x: number; y: number; width: number; height: number };
}
export interface KittyGraphicsSnapshot {
	supported: boolean;
	generation: string;
	storageLimitBytes: number;
	placements: readonly KittyPlacementSnapshot[];
}
export interface ScreenSnapshot {
	sequence: number;
	timestamp: number;
	lastVisualChangeAt: number;
	viewport: Required<Viewport>;
	activeBuffer: 'primary' | 'alternate';
	/** Renderer-ready Kitty state for the active screen only. */
	graphics: KittyGraphicsSnapshot;
	cursor: CursorSnapshot;
	lines: readonly ScreenLine[];
	modes: TerminalModes;
	title: string;
	workingDirectory?: string;
}
export interface ScreenRevision {
	sequence: number;
	timestamp: number;
	cause: 'pty-output' | 'resize' | 'reset';
	sourceFrameSequence?: number;
	changedRows: readonly number[];
	visualChange: boolean;
	snapshot: ScreenSnapshot;
}
export interface RevisionRangeQuery {
	/** Exclusive action/revision baseline. */
	since: ActionReceipt | ScreenRevision | number;
	/** Inclusive revision endpoint. */
	until?: ScreenRevision | number;
	limit?: number;
}
export interface RevisionCollectionOptions {
	since: ActionReceipt | ScreenRevision | number;
	until(snapshot: ScreenSnapshot, revision: ScreenRevision): boolean;
	timeoutMs?: number;
	maxRevisions?: number;
}
export interface RevisionCollection {
	baselineSequence: number;
	startedAt: number;
	completedAt: number;
	revisions: readonly ScreenRevision[];
}
export interface HistoryQuery {
	direction?: 'oldest-first' | 'newest-first';
	/** Zero-based index from the oldest currently retained scrollback row. */
	start?: number;
	count?: number;
	expectedGeneration?: string;
}
export interface HistoryLine extends Omit<ScreenLine, 'row'> {
	/** Zero-based index from the oldest currently retained scrollback row. */
	index: number;
	wrapContinuation: boolean;
	kittyVirtualPlaceholder: boolean;
}
export interface HistoryRange {
	generation: string;
	totalRows: number;
	start: number;
	direction: 'oldest-first' | 'newest-first';
	lines: readonly HistoryLine[];
}
export interface HistorySearchOptions {
	direction?: 'oldest-first' | 'newest-first';
	start?: number;
	maxRows?: number;
	limit?: number;
	expectedGeneration?: string;
}
export interface HistoryMatch {
	lineIndex: number;
	text: string;
	range: Rect;
	line: HistoryLine;
}
export interface CellChange {
	point: Point;
	before: ScreenCell;
	after: ScreenCell;
}
export interface ScreenReader {
	current(): ScreenSnapshot;
	getCell(point: Point): ScreenCell;
	getText(rect?: Rect): string;
	changedCells(since: ScreenSnapshot | number): readonly CellChange[];
	rawOutput(): Uint8Array;
	/** Retained revision query. `since` is exclusive and `until` is inclusive. */
	revisions(query: RevisionRangeQuery): readonly ScreenRevision[];
	/** Cache-only image lookup; it never dereferences a live WASM graphics handle. */
	getKittyImage(id: number): KittyImageSnapshot | undefined;
	scrollback(): readonly ScreenLine[];
	clipboard(): string;
}
export interface AsyncRevisionObserver {
	collect(options: RevisionCollectionOptions): Promise<RevisionCollection>;
}
export interface OperationRevisionObserver {
	collect(options: RevisionCollectionOptions): Operation<RevisionCollection>;
}
export interface AsyncHistoryReader {
	read(query?: HistoryQuery): Promise<HistoryRange>;
	findText(text: string, options?: HistorySearchOptions): Promise<readonly HistoryMatch[]>;
}
export interface OperationHistoryReader {
	read(query?: HistoryQuery): Operation<HistoryRange>;
	findText(text: string, options?: HistorySearchOptions): Operation<readonly HistoryMatch[]>;
}
export interface AsyncGraphicsReader {
	inspectImage(id: number): Promise<KittyImageSnapshot | undefined>;
	copyImageData(id: number): Promise<Uint8Array | undefined>;
}
export interface OperationGraphicsReader {
	inspectImage(id: number): Operation<KittyImageSnapshot | undefined>;
	copyImageData(id: number): Operation<Uint8Array | undefined>;
}

export interface AsyncLocator {
	nth(index: number): AsyncLocator;
	region(rect: Rect): AsyncLocator;
	matches(): readonly LocatorMatch[];
	click(options?: MouseOptions): Promise<ActionReceipt>;
}
export interface OperationLocator {
	nth(index: number): OperationLocator;
	region(rect: Rect): OperationLocator;
	matches(): readonly LocatorMatch[];
	click(options?: MouseOptions): Operation<ActionReceipt>;
}
export interface AsyncRegion {
	getByText(text: string, options?: TextLocatorOptions): AsyncLocator;
	snapshot(): ScreenSnapshot;
}
export interface OperationRegion {
	getByText(text: string, options?: TextLocatorOptions): OperationLocator;
	snapshot(): ScreenSnapshot;
}
export interface AsyncTerminal {
	readonly keyboard: {
		press(key: KeyName | KeyPress): Promise<ActionReceipt>;
		type(text: string, options?: TraceableInputOptions): Promise<ActionReceipt>;
		paste(text: string, options?: TraceableInputOptions): Promise<ActionReceipt>;
		focus(state: 'in' | 'out'): Promise<ActionReceipt>;
		write(data: Uint8Array): Promise<ActionReceipt>;
	};
	readonly mouse: {
		move(point: Point, options?: MouseOptions): Promise<ActionReceipt>;
		down(point: Point, options?: MouseOptions): Promise<ActionReceipt>;
		up(point: Point, options?: MouseOptions): Promise<ActionReceipt>;
		click(point: Point, options?: MouseOptions): Promise<ActionReceipt>;
		doubleClick(point: Point, options?: MouseOptions): Promise<ActionReceipt>;
		drag(start: Point, end: Point, options?: MouseOptions): Promise<ActionReceipt>;
		wheel(options: WheelOptions): Promise<ActionReceipt>;
	};
	readonly process: {
		status(): ProcessStatus;
		signal(signal: string, target?: 'child' | 'process-group'): Promise<ActionReceipt>;
		waitForExit(options?: AssertionOptions): Promise<ProcessStatus>;
	};
	readonly screen: ScreenReader;
	readonly revisions: AsyncRevisionObserver;
	readonly history: AsyncHistoryReader;
	readonly graphics: AsyncGraphicsReader;
	getByText(text: string, options?: TextLocatorOptions): AsyncLocator;
	region(rect: Rect): AsyncRegion;
	resize(viewport: Viewport): Promise<ActionReceipt>;
	close(): Promise<ActionReceipt>;
}
export interface OperationTerminal {
	readonly keyboard: {
		press(key: KeyName | KeyPress): Operation<ActionReceipt>;
		type(text: string, options?: TraceableInputOptions): Operation<ActionReceipt>;
		paste(text: string, options?: TraceableInputOptions): Operation<ActionReceipt>;
		focus(state: 'in' | 'out'): Operation<ActionReceipt>;
		write(data: Uint8Array): Operation<ActionReceipt>;
	};
	readonly mouse: {
		move(point: Point, options?: MouseOptions): Operation<ActionReceipt>;
		down(point: Point, options?: MouseOptions): Operation<ActionReceipt>;
		up(point: Point, options?: MouseOptions): Operation<ActionReceipt>;
		click(point: Point, options?: MouseOptions): Operation<ActionReceipt>;
		doubleClick(point: Point, options?: MouseOptions): Operation<ActionReceipt>;
		drag(start: Point, end: Point, options?: MouseOptions): Operation<ActionReceipt>;
		wheel(options: WheelOptions): Operation<ActionReceipt>;
	};
	readonly process: {
		status(): ProcessStatus;
		signal(signal: string, target?: 'child' | 'process-group'): Operation<ActionReceipt>;
		waitForExit(options?: AssertionOptions): Operation<ProcessStatus>;
	};
	readonly screen: ScreenReader;
	readonly revisions: OperationRevisionObserver;
	readonly history: OperationHistoryReader;
	readonly graphics: OperationGraphicsReader;
	getByText(text: string, options?: TextLocatorOptions): OperationLocator;
	region(rect: Rect): OperationRegion;
	resize(viewport: Viewport): Operation<ActionReceipt>;
	close(): Operation<ActionReceipt>;
}

export interface OperationLocatorExpectation {
	toBePresent(options?: AssertionOptions): Operation<LocatorMatch>;
	toBeAbsent(options?: StableAssertionOptions): Operation<void>;
	toBeStable(options?: StableAssertionOptions): Operation<LocatorMatch>;
}
export interface AsyncLocatorExpectation {
	toBePresent(options?: AssertionOptions): Promise<LocatorMatch>;
	toBeAbsent(options?: StableAssertionOptions): Promise<void>;
	toBeStable(options?: StableAssertionOptions): Promise<LocatorMatch>;
}
export interface OperationTerminalExpectation {
	toSatisfy(
		predicate: (snapshot: ScreenSnapshot) => boolean,
		options?: StableAssertionOptions,
	): Operation<ScreenSnapshot>;
	toHaveShown(
		predicate: (snapshot: ScreenSnapshot) => boolean,
		options?: TransientAssertionOptions,
	): Operation<ScreenRevision>;
	toHaveShownText(text: string, options?: TransientAssertionOptions): Operation<ScreenRevision>;
}
export interface AsyncTerminalExpectation {
	toSatisfy(
		predicate: (snapshot: ScreenSnapshot) => boolean,
		options?: StableAssertionOptions,
	): Promise<ScreenSnapshot>;
	toHaveShown(
		predicate: (snapshot: ScreenSnapshot) => boolean,
		options?: TransientAssertionOptions,
	): Promise<ScreenRevision>;
	toHaveShownText(text: string, options?: TransientAssertionOptions): Promise<ScreenRevision>;
}

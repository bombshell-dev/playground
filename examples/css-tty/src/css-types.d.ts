// Type stub for `@bomb.sh/css`: the package ships untyped JS, so this file
// pins the surface the example uses. Wired up through `paths` in the
// example tsconfig (type-checking only; runtime always loads the real
// package). The WIT world `bombshell:css@0.4.0` is the source of truth.

/// Rendering environment consulted by `@media` evaluation.
export interface Environment {
	viewportWidth?: number;
	viewportHeight?: number;
	colorScheme?: 'light' | 'dark';
	reducedMotion?: boolean;
	resolution?: number;
}

/// One element of the host tree: trees ship as a flat, document-ordered
/// list plus a parallel parent-index list (`NO_PARENT` marks a root).
export interface CssNode {
	tag: string;
	id?: string;
	classes?: string[];
	attributes?: [string, string][];
	/// WIT `node-state` bits: focus = 1, hover = 2, active = 4.
	state?: number;
	width?: number;
	height?: number;
	/// Inline style declarations; a real cascade slot.
	style?: string;
}

export interface Diagnostic {
	/// 0 = error, 1 = warning.
	severity: 0 | 1;
	code: string;
	message: string;
}

/// A `[name, value]` computed declaration.
export type ComputedProperty = [string, string];

export interface Sheet {
	readonly ir: Uint8Array;
	readonly diagnostics: Diagnostic[];
	compute(
		nodes: CssNode[],
		options: { parents: number[]; target: number; env?: Environment },
	): ComputedProperty[];
	computeTree(
		nodes: CssNode[],
		options: { parents: number[]; env?: Environment },
	): ComputedProperty[][];
	release(): void;
	[Symbol.dispose](): void;
}

export declare function compile(css: string, origin?: number): Sheet;

export declare function computeTree(
	sheet: Sheet,
	options: { nodes: CssNode[]; parents: number[]; env?: Environment },
): ComputedProperty[][];

/// Parent index marking a root with no parent (u32::MAX).
export declare const NO_PARENT: number;

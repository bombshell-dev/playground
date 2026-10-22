// Engine: an aggregating front for the wasm component, mirroring how a
// browser hosts stylesheets.
//
// Since `bombshell:css@0.4.0`, `compute`/`compute-tree` take a list of
// prepared sheets and cascade across them natively: later sheets win at
// equal weight, and `@layer` order is first-appearance across all sheets in
// the order given — the same rules a browser applies to document stylesheets.
// Each sheet compiles exactly once; adding or removing a sheet never
// recompiles the others.
//
// Inline styles are native too: `node.style` text is parsed by the runtime
// cascade (author origin, above every stylesheet declaration of the same
// importance, below author-`!important`), and inline declarations seed
// inheritance — children inherit the inline-overridden computed values.

import { compile, component } from './index.js';

export class Engine {
	constructor(origin = 2) {
		this.origin = origin;
		this.#sheets = [];
	}

	/// Compile and prepare a stylesheet, cascade-ordered after existing
	/// sheets. Returns an id usable with removeSheet. Throws `CompileError`
	/// (with `diagnostics`) when the sheet produces no IR.
	addSheet(css) {
		const sheet = compile(css, this.origin);
		const id = this.#nextId++;
		this.#sheets.push({ id, css, sheet });
		return id;
	}

	/// Remove a previously added sheet by id.
	removeSheet(id) {
		const index = this.#sheets.findIndex((entry) => entry.id === id);
		if (index === -1) return false;
		this.#sheets[index].sheet.release();
		this.#sheets.splice(index, 1);
		return true;
	}

	/// Drop all sheets.
	clear() {
		for (const entry of this.#sheets) entry.sheet.release();
		this.#sheets = [];
	}

	get sheetCount() {
		return this.#sheets.length;
	}

	/// Diagnostics from every sheet's compile, in cascade order.
	get diagnostics() {
		return this.#sheets.flatMap((entry) => entry.sheet.diagnostics);
	}

	/// Computed style for one node across all sheets.
	compute(nodes, parents, target, env) {
		const handles = this.#handles();
		if (handles.length === 0) return [];
		return component.compute(handles, nodes, parents, target, env);
	}

	/// Computed styles for every node in one pass, index-aligned with
	/// `nodes`.
	computeTree(nodes, parents, env) {
		const handles = this.#handles();
		if (handles.length === 0) return nodes.map(() => []);
		return component.computeTree(handles, nodes, parents, env);
	}

	/// Release every prepared sheet. A later `compute` re-prepares from the
	/// retained source text.
	release() {
		for (const entry of this.#sheets) {
			entry.sheet.release();
			entry.sheet = null;
		}
	}

	[Symbol.dispose]() {
		this.release();
	}

	[Symbol.asyncDispose]() {
		this.release();
		return Promise.resolve();
	}

	#handles() {
		return this.#sheets.map((entry) => {
			if (entry.sheet === null) {
				entry.sheet = compile(entry.css, this.origin);
			}
			return entry.sheet.handle;
		});
	}

	#sheets;
	#nextId = 1;
}

/// Create an engine hosting any number of author stylesheets.
export function createEngine(origin = 2) {
	return new Engine(origin);
}

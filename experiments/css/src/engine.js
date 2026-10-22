// Engine: an aggregating front for the wasm component, mirroring how a
// browser hosts stylesheets.
//
// - Sheets are kept as source text and concatenated in the order they were
//   added. That is exactly the cascade browsers apply across multiple author
//   stylesheets (later wins at equal weight; `@layer` first-appearance order
//   composes across sheets), so semantics stay correct. The cost is a full
//   recompile on edit, which is deferred (dirty flag) until the next compute
//   call, so N addSheet calls in a row cost one compile.
// - Inline styles (`node.style`) are merged per node after the wasm cascade.
//   The computed output crossing the ABI carries no importance flag, so the
//   merge tracks the set of properties declared `!important` anywhere in the
//   engine's sheets: inline-normal defers to those; inline-`!important` wins
//   over everything. Two documented deviations from browser behavior:
//     1. an `!important` declaration in a rule that does NOT match the node
//        still shields that property against inline-normal styles;
//     2. inline declarations do not seed inheritance — a child inherits the
//        sheet value of `--x`, not the parent's inline override, because the
//        merge runs after the wasm inheritance pass.
//   The correct fix is Rust-side: add `style: option<string>` to the WIT
//   `node` record and let the cascade slot inline declarations into their
//   proper layer (author origin, above any selector specificity, below
//   author-`!important`).

import { compile } from './index.js';

/// Parse an inline style attribute into [name, value, important] triples.
export function parseInlineStyle(text) {
	const declarations = [];
	for (const part of String(text).split(';')) {
		const colon = part.indexOf(':');
		if (colon < 1) continue;
		const name = part.slice(0, colon).trim().toLowerCase();
		let value = part.slice(colon + 1).trim();
		let important = false;
		if (/!\s*important$/i.test(value)) {
			important = true;
			value = value.replace(/!\s*important$/i, '').trim();
		}
		if (name && value) declarations.push([name, value, important]);
	}
	return declarations;
}

function importantProperties(rules) {
	const names = new Set();
	for (const rule of rules) {
		for (const declaration of rule.declarations) {
			if (declaration.important) names.add(declaration.name.toLowerCase());
		}
	}
	return names;
}

function mergeInline(computed, styleText, shielded) {
	if (!styleText) return computed;
	const inline = parseInlineStyle(styleText);
	if (inline.length === 0) return computed;
	const merged = new Map(computed);
	for (const [name, value, important] of inline) {
		if (!important && shielded.has(name)) continue; // sheet !important holds
		merged.set(name, value);
	}
	return [...merged];
}

export class Engine {
	constructor(origin = 2) {
		this.origin = origin;
		this.#sheets = [];
		this.#dirty = true;
		this.#sheet = null;
		this.#shielded = new Set();
	}

	/// Add a stylesheet (source text). Returns an id usable with removeSheet.
	addSheet(css) {
		const id = this.#nextId++;
		this.#sheets.push({ id, css });
		this.#dirty = true;
		return id;
	}

	/// Remove a previously added sheet by id. Recompiles lazily.
	removeSheet(id) {
		const before = this.#sheets.length;
		this.#sheets = this.#sheets.filter((sheet) => sheet.id !== id);
		if (this.#sheets.length !== before) this.#dirty = true;
		return this.#sheets.length !== before;
	}

	/// Drop all sheets.
	clear() {
		if (this.#sheets.length === 0) return;
		this.#sheets = [];
		this.#dirty = true;
	}

	get sheetCount() {
		return this.#sheets.length;
	}

	/// Diagnostics from the last compile (lazily triggered).
	get diagnostics() {
		this.#ensurePrepared();
		return this.#sheet ? this.#sheet.diagnostics : [];
	}

	/// Computed style for one node, with inline styles merged.
	compute(nodes, parents, target, env) {
		this.#ensurePrepared();
		if (!this.#sheet) return [];
		const computed = this.#sheet.compute(nodes, parents, target, env);
		return mergeInline(computed, nodes[target]?.style, this.#shielded);
	}

	/// Computed styles for every node in one pass, inline styles merged
	/// per node.
	computeTree(nodes, parents, env) {
		this.#ensurePrepared();
		if (!this.#sheet) return nodes.map(() => []);
		const perNode = this.#sheet.computeTree(nodes, parents, env);
		return perNode.map((computed, i) => mergeInline(computed, nodes[i]?.style, this.#shielded));
	}

	release() {
		if (this.#sheet) {
			this.#sheet.release();
			this.#sheet = null;
		}
		this.#dirty = true;
	}

	[Symbol.dispose]() {
		this.release();
	}

	[Symbol.asyncDispose]() {
		this.release();
		return Promise.resolve();
	}

	#ensurePrepared() {
		if (!this.#dirty && this.#sheet !== null) return;
		this.release();
		const css = this.#sheets.map((sheet) => sheet.css).join('\n');
		if (css.trim() === '') {
			this.#shielded = new Set();
			this.#dirty = false;
			return;
		}
		const sheet = compile(css, this.origin);
		this.#shielded = importantProperties(sheet.rules);
		this.#sheet = sheet;
		this.#dirty = false;
	}

	#sheets;
	#nextId = 1;
	#dirty;
	#sheet;
	#shielded;
}

/// Create an engine hosting any number of author stylesheets.
export function createEngine(origin = 2) {
	return new Engine(origin);
}

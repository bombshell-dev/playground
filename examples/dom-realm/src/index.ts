import { createContext, Script, type Context } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';
import { installParsing } from '@bomb.sh/dom/parsing';
import {
	Attr,
	CharacterData,
	Comment,
	CustomEvent,
	Document,
	DocumentFragment,
	Element,
	Event,
	EventTarget,
	MutationObserver,
	Node,
	ShadowRoot,
	Text,
} from '@bomb.sh/dom';

class FixtureBuildError extends Error {
	readonly entry: URL;
	constructor(entry: URL) {
		super(`Fixture compilation produced no JavaScript for ${entry.href}`);
		this.name = 'FixtureBuildError';
		this.entry = entry;
	}
}

/** Browser-targeted fixture compilation, kept entirely outside the DOM package. */
export async function bundleFixture(entry: URL, plugins: Plugin[] = []): Promise<string> {
	const result = await build({
		entryPoints: [fileURLToPath(entry)],
		bundle: true,
		write: false,
		format: 'iife',
		globalName: 'fixture',
		platform: 'browser',
		target: 'es2022',
		conditions: ['browser'],
		define: { 'process.env.NODE_ENV': '"production"' },
		plugins,
	});
	const output = result.outputFiles[0];
	if (!output) throw new FixtureBuildError(entry);
	return output.text;
}

/**
 * A persistent module/global environment for trusted local framework examples.
 * This is an integration boundary, not a browser or an untrusted-code sandbox.
 * Core nodes and their mutation implementation remain the same objects.
 */
export class FixtureRealm {
	readonly document: Document;
	readonly #context: Context;

	constructor(document: Document) {
		this.document = document;
		installParsing(document);
		const windowEvents = new EventTarget();
		const environment: Record<string, unknown> = {
			document,
			customElements: document.customElements,
			HTMLElement: document.HTMLElement,
			Attr,
			CharacterData,
			Comment,
			CustomEvent,
			Document,
			DocumentFragment,
			Element,
			Event,
			EventTarget,
			MutationObserver,
			Node,
			ShadowRoot,
			Text,
			DOMException,
			AbortController,
			AbortSignal,
			console,
			queueMicrotask,
			setTimeout,
			clearTimeout,
			performance,
			navigator: { userAgent: '@bomb.sh/dom framework fixture' },
			addEventListener: windowEvents.addEventListener.bind(windowEvents),
			removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
			dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
		};
		environment.window = environment;
		environment.self = environment;
		this.#context = createContext(environment);
	}

	/** Evaluate trusted fixture code; its asynchronous closures retain this realm. */
	run(source: string): unknown {
		return new Script(source, { filename: 'dom-framework-fixture.js' }).runInContext(this.#context);
	}
}

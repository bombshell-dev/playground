import type { WriteStream } from 'node:tty';
import { createTerm, type Op, type Term } from '@bomb.sh/tty';
import { type Child, normalizeChildren } from '../children.ts';
import { resolveIds } from './ids.ts';

export interface RenderRootOptions {
	/** Stream to write rendered frames to. Defaults to `process.stdout`. */
	output?: WriteStream;
	/** Render width in columns. Defaults to the output's column count. */
	width?: number;
	/** Render height in rows. Defaults to the output's row count. */
	height?: number;
}

/** Owns a tty terminal and its children; each {@link RenderRoot.render} re-renders the full op stream (diffing happens in `Term.render`). */
export class RenderRoot {
	#output: WriteStream;
	#width: number;
	#height: number;
	#term?: Term;
	#children: Op[] = [];
	#rafId: ReturnType<typeof setTimeout> | null = null;
	#wasAnimating = false;

	constructor(options: RenderRootOptions = {}) {
		this.#output = options.output ?? process.stdout;
		this.#width = options.width ?? this.#output.columns ?? 80;
		this.#height = options.height ?? this.#output.rows ?? 24;
	}

	/** Initialize the terminal. Required before {@link RenderRoot.render}; {@link createRoot} awaits it for you. */
	async ready(): Promise<void> {
		this.#term ??= await createTerm({ width: this.#width, height: this.#height });
	}

	/**
	 * Render `children` to the output, replacing the previous frame. Call with no
	 * arguments to re-render the current children (e.g. on resize).
	 *
	 * Synchronous on purpose: `Term.render` and the stream write are both sync, so each
	 * call runs to completion before the next starts — no await means no microtask gap in
	 * which a later `render` could clobber this frame. Requires {@link RenderRoot.ready}.
	 *
	 * When transitions are active, follow-up frames are scheduled automatically
	 * so animations play out without the caller needing to drive the loop.
	 */
	render(...children: Child[]): void {
		if (!this.#term)
			throw new Error(
				'RenderRoot is not ready: await `ready()` (or use `createRoot`) before `render`.',
			);
		if (children.length > 0) this.#children = resolveIds(normalizeChildren(children));
		if (this.#rafId !== null) {
			clearTimeout(this.#rafId);
			this.#rafId = null;
		}
		const { output, animating } = this.#term.render(this.#children, { mode: 'line' });
		this.#output.write(output);
		if (animating) {
			this.#wasAnimating = true;
			this.#rafId = setTimeout(() => {
				this.#rafId = null;
				this.render();
			}, 16);
		} else if (this.#wasAnimating) {
			this.#wasAnimating = false;
		}
	}
}
export async function createRoot(options?: Pick<RenderRootOptions, 'output'>): Promise<RenderRoot> {
	const root = new RenderRoot(options);
	await root.ready();
	return root;
}

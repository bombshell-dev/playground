import { call, resource, type Operation } from 'effection';
import { readFile } from 'node:fs/promises';
import type { BackendOptions, BackendUpdate, TerminalBackend } from '../backend.ts';
import { SessionClosedError } from '../errors.ts';
import { GhosttyWasmTerminal } from './wasm.ts';

/** Pinned Ghostty, with one WASM instance owned by the acquiring scope. */
// oxlint-disable-next-line bombshell-dev/exported-function-async, bombshell-dev/require-export-jsdoc -- Scoped acquisition returns an Effection Operation; documented above.
export function createGhosttyBackend(options: BackendOptions): Operation<TerminalBackend> {
	return resource(function* (provide) {
		// Observe late acquisition even if the owning operation is cancelled.
		const opening = GhosttyWasmTerminal.create(
			options.viewport,
			options.graphicsStorageLimitBytes,
		).then(
			(engine) => ({ ok: true as const, engine }),
			(error) => ({ ok: false as const, error }),
		);
		let closed = false;
		try {
			const result = yield* call(() => opening);
			if (!result.ok) throw result.error;
			const engine = result.engine;
			const lock = JSON.parse(
				yield* call(() =>
					readFile(
						new URL(
							import.meta.url.includes('/dist/')
								? '../ghostty.lock.json'
								: '../../ghostty.lock.json',
							import.meta.url,
						),
						'utf8',
					),
				),
			);
			const check = (): void => {
				if (closed) throw new SessionClosedError('Terminal backend scope is closed');
			};
			const update = (cause: 'pty-output' | 'resize'): BackendUpdate =>
				Object.freeze({
					snapshot: engine.snapshot(cause),
					effects: Object.freeze(engine.takeEffects()),
				});
			const backend: TerminalBackend = {
				identity: Object.freeze({
					name: 'ghostty',
					version: lock.artifacts['artifacts/ghostty-vt.wasm'].sha256,
				}),
				write(bytes) {
					check();
					engine.write(bytes);
					return update('pty-output');
				},
				resize(viewport) {
					check();
					engine.resize(viewport);
					return update('resize');
				},
				snapshot() {
					check();
					return engine.snapshot();
				},
				encodeKey(key) {
					check();
					return engine.encodeKey(key);
				},
				encodeMouse(action, point, mouseOptions, anyButtonPressed) {
					check();
					return engine.encodeMouse(action, point, mouseOptions, anyButtonPressed);
				},
				encodePaste(text) {
					check();
					return engine.encodePaste(text);
				},
				encodeFocus(state) {
					check();
					return engine.encodeFocus(state);
				},
				scrollbackRows() {
					check();
					return engine.scrollbackRows();
				},
				history(start, count) {
					check();
					return engine.history(start, count);
				},
				clipboard() {
					check();
					return engine.clipboard();
				},
				inspectImage(id) {
					check();
					return engine.inspectImage(id);
				},
				copyImageData(id) {
					check();
					return engine.copyImageData(id);
				},
				cachedImage(id) {
					check();
					return engine.cachedImage(id);
				},
			};
			yield* provide(Object.freeze(backend));
		} finally {
			closed = true;
			const result = yield* call(() => opening);
			if (result.ok) result.engine.free();
		}
	});
}

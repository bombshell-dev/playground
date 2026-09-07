import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
// oxlint-disable-next-line no-restricted-imports -- trace artifact paths
import { join } from 'node:path';
import {
	replayTrace,
	sequence,
	textContains,
	type Matcher,
	type ScreenSnapshot,
} from '../../src/index.ts';
import { netrw } from './netrw.ts';
import { withVim } from './fixture.ts';

for (const viewport of [
	{ columns: 80, rows: 24 },
	{ columns: 100, rows: 36 },
]) {
	test(`drag Vim's divider, keep editing, and replay at ${viewport.columns}×${viewport.rows}`, async () => {
		// Remove traces only after all assertions pass. A failed live or offline
		// assertion leaves its artifacts here for diagnosis.
		await mkdir('.ghostwright', { recursive: true });
		const traces = await mkdtemp('.ghostwright/vim-drag-');
		const journey = await withVim(
			{ viewport, trace: { policy: 'on', directory: traces } },
			async (ui) => {
				const readme = netrw(ui).find('README.md');
				await readme.open();
				const before = await ui.screen.findBy(readme.editor);
				expect(before.text()).toContain('This text came from README.md.');

				// The editor recognizer found this divider from its painted cells.
				// Derive the neighboring pane from the same observation, not Vim internals.
				const divider = readme.editor.derive('right divider', (editor) => [
					{
						column: editor.bounds.column + editor.bounds.width,
						row: editor.bounds.row,
						width: 1,
						height: editor.bounds.height,
					},
				]);
				const neighbor = divider.derive('neighboring editor', (edge) => [
					{
						column: edge.bounds.column + 1,
						row: edge.bounds.row,
						width: edge.screen.viewport.columns - edge.bounds.column - 1,
						height: edge.bounds.height,
					},
				]);
				expect((await ui.screen.findBy(divider)).text()).toContain('|');
				const neighboringBefore = await ui.screen.findBy(neighbor);
				expect(neighboringBefore.text()).toContain('This is a decoy');
				const widened: Matcher = (editor) => ({
					pass: editor.bounds.width === before.bounds.width + 8,
					expected: 'left editor widened by eight columns',
					actual: editor.bounds,
				});
				const edited = textContains('Resized: # Opened through the explorer');

				const recording = await ui.capture(
					{ until: sequence(readme.editor.satisfies(widened), readme.editor.satisfies(edited)) },
					async (capture) => {
						// Real button-down, motion, button-up. No :vertical resize command
						// and no terminal viewport resize masquerading as a mouse gesture.
						await capture.mouse.drag(divider, { by: { columns: 8, rows: 0 } });
						await capture.waitFor(() =>
							expect(capture.screen.getBy(readme.editor).bounds.width).toBe(
								before.bounds.width + 8,
							),
						);
						const neighboringAfter = await capture.screen.findBy(neighbor);
						expect(neighboringAfter.text()).toContain('This is a decoy');
						expect(neighboringAfter.text()).toContain('README.md');
						expect(neighboringAfter.text()).toContain('editor.');
						expect(neighboringAfter.bounds.width).toBe(neighboringBefore.bounds.width - 8);
						expect(neighboringAfter.bounds.column).toBe(neighboringBefore.bounds.column + 8);
						expect(neighboringAfter.screen.viewport).toEqual(before.screen.viewport);
						expect((await capture.screen.findBy(readme.editor)).text()).toContain(
							'This text came from README.md.',
						);

						// Edit in memory: the file remains usable after mouse resizing.
						await capture.keyboard.type('ggIResized: ');
						await capture.keyboard.press('Escape');
						await capture.waitFor(() =>
							expect(capture.screen.getBy(readme.editor).text()).toContain(
								'Resized: # Opened through the explorer',
							),
						);
					},
				);

				// Keep using the live application after recording has ended. The
				// recording must retain the edit even after undo and process exit.
				await ui.keyboard.type('u');
				await ui.waitFor(() => {
					const restored = ui.screen.getBy(readme.editor);
					expect(restored.text()).not.toContain('Resized:');
					expect(restored.text()).toContain('# Opened through the explorer');
				});
				await ui.keyboard.type(':qa!');
				await ui.keyboard.press('Enter');
				expect((await ui.process.waitForExit()).exitCode).toBe(0);
				return { recording, editor: readme.editor, divider, neighbor, widened, edited };
			},
		);

		// Vim is closed and its temporary files are gone. Replay reads only the trace.
		const path = join(traces, (await readdir(traces))[0]!);
		const replay = await replayTrace(path);
		const { recording, editor, divider, neighbor, widened, edited } = journey;
		const endpoint = recording.observations.at(-1)!;
		const replayed = replay.observations.filter(
			(observation) =>
				observation.sequence >= recording.baseline.sequence &&
				observation.sequence <= endpoint.sequence,
		);
		const captured = [recording.baseline, ...recording.observations];
		expect(replayed.map((observation) => observation.sequence)).toEqual(
			captured.map((observation) => observation.sequence),
		);
		for (const [index, observation] of replayed.entries()) {
			// Compare every captured state, not only the final text. Wall-clock
			// timestamps differ; cells (including styles), cursor, modes, and order must not.
			expect(evidence(observation.screen)).toEqual(evidence(captured[index]!.screen));
			for (const query of [editor, divider, neighbor]) {
				expect(query.resolve(observation).map((region) => region.bounds)).toEqual(
					query.resolve(captured[index]!).map((region) => region.bounds),
				);
			}
		}

		// The same authored matchers work on reconstructed evidence without a session.
		const lastEditor = editor.resolve(replayed.at(-1)!)[0]!;
		expect(widened(lastEditor).pass).toBe(true);
		expect(edited(lastEditor).pass).toBe(true);
		expect(edited(editor.resolve(recording.baseline)[0]!).pass).toBe(false);
		expect(edited(editor.resolve(endpoint)[0]!).pass).toBe(true);
		await rm(traces, { recursive: true, force: true });
	});
}

function evidence(
	snapshot: ScreenSnapshot,
): Omit<ScreenSnapshot, 'timestamp' | 'lastVisualChangeAt'> {
	const { timestamp: _timestamp, lastVisualChangeAt: _lastVisualChangeAt, ...state } = snapshot;
	return state;
}

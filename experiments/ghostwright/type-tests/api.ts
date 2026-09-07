import {
	createExpect,
	defineMatchers,
	defineLocator,
	defineScreenLocator,
	textContains,
	type AsyncExecution,
	type RegionInspection,
	type EffectionTerminal,
} from '../src/index.ts';

declare const ui: AsyncExecution;
declare const native: EffectionTerminal;
const cursor = defineScreenLocator('cursor cell', (screen) => [
	{ ...screen.cursor, width: 1, height: 1 },
]);
ui.expect(cursor).toContainCursor({ visible: true });
// @ts-expect-error A screen resolver returns regions synchronously, not pending work.
defineScreenLocator('async resolver', async () => []);
const field = defineLocator<{
	bounds: { column: number; row: number; width: number; height: number };
}>('test', 'field', (description) => [description.bounds]);
const expect = createExpect().extend(
	defineMatchers({
		toShow(actual: RegionInspection, text: string) {
			return textContains(text)(actual);
		},
	}),
);
const firstCell = field.derive('first cell', (parent) => [{ ...parent.bounds, width: 1 }]);
expect(ui, firstCell).toShow('h');
// @ts-expect-error Child resolution is synchronous, just like root resolution.
field.derive('async child', async () => []);
// @ts-expect-error A child resolver returns terminal rectangles, not snapshots.
field.derive('wrong result', (parent) => [parent.screen]);
expect(ui, field).toShow('hello');
expect(ui, field).toContainText('hello');
expect.operation(native, field).toShow('hello');
// @ts-expect-error Operation facade keeps custom argument types too.
expect.operation(native, field).toShow(12);
// @ts-expect-error Custom matcher argument types survive extension.
expect(ui, field).toShow(12);
// @ts-expect-error Registration is local, not global declaration merging.
ui.expect(field).toShow('hello');
// @ts-expect-error Query construction cannot execute an action.
field.click();
// @ts-expect-error A matcher must provide diagnostics, not only a boolean.
defineMatchers({ toBeMagic: (_actual: RegionInspection) => true });
ui.capture({ until: field.satisfies(textContains('done')) }, async (capture) => {
	const signal: AbortSignal = capture.signal;
	await capture.keyboard.type('hello');
	void signal;
});

import { expect as jestExpect } from '@jest/globals';
import { expect as vitestExpect } from 'vitest';
// oxlint-disable-next-line import/no-unassigned-import -- Check the public matcher augmentation.
import '../src/jest.ts';
// oxlint-disable-next-line import/no-unassigned-import -- Check the public matcher augmentation.
import '../src/vitest.ts';
import { type launchTerminal, regionLocator, type RegionInspection } from '../src/index.ts';
import { withTerminal } from '../src/effection/index.ts';
import type { Operation } from 'effection';

declare const terminal: Awaited<ReturnType<typeof launchTerminal>>;
const recipe = regionLocator({ column: 0, row: 0, width: 10, height: 1 });
const region: RegionInspection = terminal.screen.getBy(recipe);
const optional: RegionInspection | null = terminal.screen.queryBy(recipe);
const regions: readonly RegionInspection[] = terminal.screen.queryAllBy(recipe);
const pending: Promise<RegionInspection> = terminal.screen.findBy(recipe);
const value: Promise<number> = terminal.waitFor(async () => 42);
void [optional, regions, pending, value];
jestExpect(region).toContainText('ready');
vitestExpect(region).toContainText('ready');
// @ts-expect-error Matcher arguments retain their types through runner integration.
jestExpect(region).toContainText(42);
// @ts-expect-error Matcher arguments retain their types through runner integration.
vitestExpect(region).toHaveEdgeStyle('center', {});
// @ts-expect-error Query results are evidence, not live recipes.
terminal.screen.findBy(region);
// @ts-expect-error Query arrays cannot be mutated.
regions.push(region);
// @ts-expect-error Query results do not own a disposable lifetime.
region[Symbol.asyncDispose]();
// @ts-expect-error Standard mouse reports do not encode Super/Command.
terminal.mouse.hover(recipe, { super: true });
void terminal.mouse.drag(recipe, { by: { columns: 8, rows: 0 } });

const native: Operation<string> = withTerminal({ command: '/bin/sh' }, function* (ui) {
	const found: RegionInspection = yield* ui.screen.findBy(recipe);
	const count: number = yield* ui.waitFor(async () => 42);
	void count;
	return found.text();
});
void native;

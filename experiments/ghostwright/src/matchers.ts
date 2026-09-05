import { InvalidOptionsError } from './errors.ts';
import type { Operation } from 'effection';
import { cellsMatchStyle } from './styles.ts';
import type { Edge, RegionInspection } from './inspection.ts';
import type { RegionLocator } from './locators.ts';
import type { StyleQuery } from './types.ts';

export interface MatchResult {
	readonly pass: boolean;
	readonly expected: string;
	readonly actual: unknown;
	readonly details?: readonly MatchResult[];
}
export type Matcher = (actual: RegionInspection) => MatchResult;
export const textContains =
	(text: string): Matcher =>
	(actual) => ({
		pass: actual.text().includes(text),
		expected: `text containing ${JSON.stringify(text)}`,
		actual: actual.text(),
	});
export const cursorInside =
	(options: { visible?: boolean } = { visible: true }): Matcher =>
	(actual) => {
		const cursor = actual.cursor();
		return {
			pass: cursor.inside && (options.visible === undefined || cursor.visible === options.visible),
			expected: `cursor inside region${options.visible === undefined ? '' : `, visible=${options.visible}`}`,
			actual: cursor,
		};
	};
export const edgeHasStyle =
	(edge: Edge, style: StyleQuery): Matcher =>
	(actual) => {
		const region = actual.edge(edge),
			cells = region.cells();
		const complete =
			cells.length === region.bounds.width * region.bounds.height && cells.length > 0;
		return {
			pass: complete && cellsMatchStyle(cells, style),
			expected: `${edge} edge style ${JSON.stringify(style)}`,
			actual: cells.map((cell) => cell.style),
		};
	};
export const textHasStyle =
	(text: string, style: StyleQuery): Matcher =>
	(actual) => {
		const r = actual.visibleBounds;
		let pass = false;
		if (r && text.length)
			for (const line of actual.screen.lines.slice(r.row, r.row + r.height)) {
				const cells = line.cells
					.slice(r.column, r.column + r.width)
					.filter((cell) => !cell.continuation);
				const parts = cells.map((cell) => (cell.style.invisible ? ' ' : cell.text || ' '));
				const row = parts.join('');
				let at = row.indexOf(text);
				while (at !== -1) {
					let offset = 0;
					const matched = cells.filter((_, index) => {
						const start = offset;
						offset += parts[index]!.length;
						return start < at + text.length && offset > at;
					});
					if (matched.length && cellsMatchStyle(matched, style)) pass = true;
					at = row.indexOf(text, at + text.length);
				}
			}
		return {
			pass,
			expected: `${JSON.stringify(text)} with style ${JSON.stringify(style)}`,
			actual: actual.text(),
		};
	};
export const all =
	(...matchers: readonly Matcher[]): Matcher =>
	(actual) => {
		const details = matchers.map((matcher) => matcher(actual));
		return {
			pass: details.every((result) => result.pass),
			expected: details.map((result) => result.expected).join(' and '),
			actual: actual.text(),
			details,
		};
	};

// Each method may have its own argument tuple. `any` is confined to this
// heterogeneous registry constraint; the inferred public methods preserve it.
export type MatcherDefinitions = Record<
	string,
	(actual: RegionInspection, ...args: any[]) => MatchResult
>;
export function defineMatchers<const M extends MatcherDefinitions>(matchers: M): Readonly<M> {
	return Object.freeze({ ...matchers });
}
export const builtInMatchers = defineMatchers({
	toContainText: (actual: RegionInspection, text: string) => textContains(text)(actual),
	toContainCursor: (actual: RegionInspection, options?: { visible?: boolean }) =>
		cursorInside(options)(actual),
	toHaveEdgeStyle: (actual: RegionInspection, edge: Edge, style: StyleQuery) =>
		edgeHasStyle(edge, style)(actual),
	toHaveTextStyle: (actual: RegionInspection, text: string, style: StyleQuery) =>
		textHasStyle(text, style)(actual),
	toSatisfy: (actual: RegionInspection, matcher: Matcher) => matcher(actual),
});
export interface AssertionExecutor {
	assert(locator: RegionLocator, matcher: Matcher): Promise<RegionInspection>;
}
type Args<F> = F extends (actual: RegionInspection, ...args: infer A) => MatchResult ? A : never;
export type Expectations<M extends MatcherDefinitions> = {
	[K in keyof M]: (...args: Args<M[K]>) => Promise<RegionInspection>;
};
export type OperationExpectations<M extends MatcherDefinitions> = {
	[K in keyof M]: (...args: Args<M[K]>) => Operation<RegionInspection>;
};
export interface OperationAssertionExecutor {
	assert(locator: RegionLocator, matcher: Matcher): Operation<RegionInspection>;
}
export interface ExpectFactory<M extends MatcherDefinitions> {
	(executor: AssertionExecutor, locator: RegionLocator): Expectations<M>;
	operation(executor: OperationAssertionExecutor, locator: RegionLocator): OperationExpectations<M>;
	extend<N extends MatcherDefinitions>(matchers: N): ExpectFactory<M & N>;
}
function factory<M extends MatcherDefinitions>(definitions: M): ExpectFactory<M> {
	const expect = (executor: AssertionExecutor, locator: RegionLocator): Expectations<M> =>
		Object.fromEntries(
			Object.entries(definitions).map(([name, matcher]) => [
				name,
				(...args: unknown[]) => executor.assert(locator, (actual) => matcher(actual, ...args)),
			]),
		) as unknown as Expectations<M>; // Object.fromEntries erases each method's argument tuple.
	return Object.freeze(
		Object.assign(expect, {
			operation(
				executor: OperationAssertionExecutor,
				locator: RegionLocator,
			): OperationExpectations<M> {
				return Object.fromEntries(
					Object.entries(definitions).map(([name, matcher]) => [
						name,
						(...args: unknown[]) => executor.assert(locator, (actual) => matcher(actual, ...args)),
					]),
				) as unknown as OperationExpectations<M>;
			},
			extend<N extends MatcherDefinitions>(next: N): ExpectFactory<M & N> {
				for (const name of Object.keys(next))
					if (name in definitions)
						throw new InvalidOptionsError(`Matcher already registered: ${name}`);
				return factory({ ...definitions, ...next });
			},
		}),
	);
}
export function createExpect(): ExpectFactory<typeof builtInMatchers> {
	return factory(builtInMatchers);
}

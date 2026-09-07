import { RegionInspection } from './inspection.ts';
import { InvalidOptionsError } from './errors.ts';
import { builtInMatchers, type MatcherDefinitions, type MatchResult } from './matchers.ts';

export interface RunnerMatcherResult {
	pass: boolean;
	message(): string;
}
type Arguments<F> = F extends (region: RegionInspection, ...args: infer A) => MatchResult
	? A
	: never;
export type RunnerAssertions<M extends MatcherDefinitions = typeof builtInMatchers, R = void> = {
	[K in keyof M]: (...args: Arguments<M[K]>) => R;
};
export type RunnerMatchers<M extends MatcherDefinitions> = {
	[K in keyof M]: (
		this: { isNot?: boolean },
		actual: unknown,
		...args: Arguments<M[K]>
	) => RunnerMatcherResult;
};

function bind<Args extends unknown[]>(
	name: string,
	definition: (actual: RegionInspection, ...args: Args) => MatchResult,
): (this: { isNot?: boolean }, actual: unknown, ...args: Args) => RunnerMatcherResult {
	return function (actual, ...args) {
		if (actual === null && name === 'toBeVisible') {
			return { pass: false, message: () => 'Expected a visible region, received null' };
		}
		if (!(actual instanceof RegionInspection))
			throw new InvalidOptionsError(
				'Terminal matchers require frozen region evidence from screen.getBy/findBy, not a locator recipe',
			);
		const result = definition(actual, ...args);
		const negated = this.isNot ? 'not ' : '';
		return {
			pass: result.pass,
			message: () =>
				`Expected ${negated}${result.expected}\nRegion: ${JSON.stringify(actual.bounds)}\nReceived: ${JSON.stringify(result.actual)}`,
		};
	};
}

/** Adapt local pure matchers to expect.extend without adding retries or a global registry. */
export function createRunnerMatchers<M extends MatcherDefinitions>(
	definitions: M,
): RunnerMatchers<M> {
	// Dynamic enumeration erases the association between each method and its tuple.
	return Object.fromEntries(
		Object.entries(definitions).map(([name, definition]) => [name, bind(name, definition)]),
	) as unknown as RunnerMatchers<M>;
}
export const terminalMatchers = createRunnerMatchers(builtInMatchers);

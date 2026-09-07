import { GhostwrightError, InvalidOptionsError, StrictLocatorError } from './errors.ts';
import { defineScreenLocator, type RegionLocator } from './locators.ts';
import type { Observation } from './observations.ts';
import type { RegionInspection } from './inspection.ts';
import type { TextLocatorOptions } from './types.ts';
import type { WaitFor, WaitForOptions } from './wait-for.ts';
import { findText } from './terminal/text.ts';

/** A pure text recipe. UTF-16 string offsets never become terminal coordinates. */
export function textLocator(text: string, options: TextLocatorOptions = {}): RegionLocator {
	if (!text.length) throw new InvalidOptionsError('Text queries require nonempty text');
	const settings = structuredClone({ exact: options.exact, style: options.style });
	return defineScreenLocator(`text ${JSON.stringify(text)}`, (screen) =>
		findText(screen, text, settings).map((match) => match.range),
	);
}
export interface QueryContext {
	current(locator: RegionLocator): Observation | undefined;
	waitFor: WaitFor;
	selector?: (source: string) => RegionLocator;
}
export type TextQueryOptions = TextLocatorOptions & WaitForOptions;

/** Every query family resolves through the same cardinality and waiting rules. */
export function createQueries(context: QueryContext): ScreenQueries {
	const queryAllBy = (locator: RegionLocator): readonly RegionInspection[] => {
		const observation = context.current(locator);
		if (!observation)
			throw new GhostwrightError({
				code: 'GW_QUERY_UNAVAILABLE',
				message: `No current observation for ${locator.source}; wait for a description paired with the current screen`,
			});
		return Object.freeze([...locator.resolve(observation)]);
	};
	const queryBy = (locator: RegionLocator): RegionInspection | null => {
		const matches = queryAllBy(locator);
		if (matches.length > 1)
			throw new StrictLocatorError(
				`${locator.source} matched ${matches.length} regions: ${JSON.stringify(matches.map((match) => match.bounds))}`,
			);
		return matches[0] ?? null;
	};
	const missing = (locator: RegionLocator): never => {
		throw new GhostwrightError({
			code: 'GW_QUERY_MISSING',
			message: `No region matched ${locator.source}`,
		});
	};
	const getBy = (locator: RegionLocator): RegionInspection => queryBy(locator) ?? missing(locator);
	const getAllBy = (locator: RegionLocator): readonly RegionInspection[] => {
		const matches = queryAllBy(locator);
		return matches.length ? matches : missing(locator);
	};
	const findBy = (locator: RegionLocator, options?: WaitForOptions): Promise<RegionInspection> =>
		context.waitFor(() => getBy(locator), options);
	const findAllBy = (
		locator: RegionLocator,
		options?: WaitForOptions,
	): Promise<readonly RegionInspection[]> => context.waitFor(() => getAllBy(locator), options);
	const selector = (source: string): RegionLocator => {
		if (!context.selector)
			throw new InvalidOptionsError(
				'Selector queries require a selector adapter in launch options',
			);
		return context.selector(source);
	};
	return Object.freeze({
		getBy,
		queryBy,
		findBy,
		getAllBy,
		queryAllBy,
		findAllBy,
		getByText: (text: string, options?: TextLocatorOptions) => getBy(textLocator(text, options)),
		queryByText: (text: string, options?: TextLocatorOptions) =>
			queryBy(textLocator(text, options)),
		getAllByText: (text: string, options?: TextLocatorOptions) =>
			getAllBy(textLocator(text, options)),
		queryAllByText: (text: string, options?: TextLocatorOptions) =>
			queryAllBy(textLocator(text, options)),
		findByText: async (text: string, options?: TextQueryOptions) =>
			findBy(textLocator(text, options), options),
		findAllByText: async (text: string, options?: TextQueryOptions) =>
			findAllBy(textLocator(text, options), options),
		getBySelector: (source: string) => getBy(selector(source)),
		queryBySelector: (source: string) => queryBy(selector(source)),
		getAllBySelector: (source: string) => getAllBy(selector(source)),
		queryAllBySelector: (source: string) => queryAllBy(selector(source)),
		findBySelector: async (source: string, options?: WaitForOptions) =>
			findBy(selector(source), options),
		findAllBySelector: async (source: string, options?: WaitForOptions) =>
			findAllBy(selector(source), options),
	});
}
export interface ScreenQueries {
	getBy(locator: RegionLocator): RegionInspection;
	queryBy(locator: RegionLocator): RegionInspection | null;
	getAllBy(locator: RegionLocator): readonly RegionInspection[];
	queryAllBy(locator: RegionLocator): readonly RegionInspection[];
	findBy(locator: RegionLocator, options?: WaitForOptions): Promise<RegionInspection>;
	findAllBy(locator: RegionLocator, options?: WaitForOptions): Promise<readonly RegionInspection[]>;
	getByText(text: string, options?: TextLocatorOptions): RegionInspection;
	queryByText(text: string, options?: TextLocatorOptions): RegionInspection | null;
	getAllByText(text: string, options?: TextLocatorOptions): readonly RegionInspection[];
	queryAllByText(text: string, options?: TextLocatorOptions): readonly RegionInspection[];
	findByText(text: string, options?: TextQueryOptions): Promise<RegionInspection>;
	findAllByText(text: string, options?: TextQueryOptions): Promise<readonly RegionInspection[]>;
	getBySelector(source: string): RegionInspection;
	queryBySelector(source: string): RegionInspection | null;
	getAllBySelector(source: string): readonly RegionInspection[];
	queryAllBySelector(source: string): readonly RegionInspection[];
	findBySelector(source: string, options?: WaitForOptions): Promise<RegionInspection>;
	findAllBySelector(source: string, options?: WaitForOptions): Promise<readonly RegionInspection[]>;
}

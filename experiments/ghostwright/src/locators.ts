import { GhostwrightError, InvalidOptionsError } from './errors.ts';
import { RegionInspection } from './inspection.ts';
import type { Observation } from './observations.ts';
import type { Rect } from './types.ts';
import type { Matcher } from './matchers.ts';
import type { Condition } from './conditions.ts';

/** Immutable query data and a pure resolver. No session, tasks, or cached geometry. */
export interface RegionLocator {
	readonly source: string;
	readonly extensionId?: string;
	accepts(observation: Observation): boolean;
	resolve(observation: Observation): readonly RegionInspection[];
	nth(index: number): RegionLocator;
	satisfies(matcher: Matcher): Condition;
}
// oxlint-disable-next-line bombshell-dev/max-params -- immutable identity and pure resolution function
function query(
	source: string,
	extensionId: string | undefined,
	resolve: (observation: Observation) => readonly Rect[],
): RegionLocator {
	const locator: RegionLocator = {
		source,
		extensionId,
		accepts: (o) =>
			extensionId === undefined
				? o.kind === 'screen'
				: o.kind !== 'screen' && o.extensionId === extensionId,
		resolve(observation) {
			if (!locator.accepts(observation)) return [];
			if (observation.kind === 'extension-error') throw observation.error;
			return Object.freeze(
				resolve(observation).map((bounds) => new RegionInspection(observation.screen, bounds)),
			);
		},
		nth(index) {
			if (!Number.isSafeInteger(index) || index < 0)
				throw new InvalidOptionsError('Locator index must be nonnegative');
			return query(`${source}.nth(${index})`, extensionId, (o) => {
				const bounds = resolve(o)[index];
				return bounds ? [bounds] : [];
			});
		},
		satisfies(matcher) {
			return Object.freeze({
				create: () => ({
					observe: (o: Observation) => {
						if (!locator.accepts(o)) return false;
						const regions = locator.resolve(o);
						if (regions.length > 1)
							throw new GhostwrightError({
								code: 'GW_LOCATOR_STRICT',
								message: `${source} matched ${regions.length} regions`,
							});
						return regions.length === 1 && matcher(regions[0]!).pass;
					},
				}),
			});
		},
	};
	return Object.freeze(locator);
}
// oxlint-disable-next-line bombshell-dev/max-params -- immutable identity and pure resolution function
export function defineLocator<T>(
	extensionId: string,
	source: string,
	resolve: (description: T) => readonly Rect[],
): RegionLocator {
	return query(source, extensionId, (o) =>
		o.kind === 'extension' ? resolve(o.description as T) : [],
	);
}
/** Fixed coordinates are an explicit alternative to semantic location. */
export function regionLocator(bounds: Rect): RegionLocator {
	const copy = Object.freeze({ ...bounds });
	return query(JSON.stringify(copy), undefined, () => [copy]);
}

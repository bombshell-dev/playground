import { InvalidOptionsError, StrictLocatorError } from './errors.ts';
import type { Observation } from './observations.ts';
import type { RegionLocator } from './locators.ts';

/** Fresh state per wait/capture. A condition is reusable; its evaluator is not. */
export interface ConditionState {
	observe(observation: Observation): boolean;
	baseline?(observation: Observation): void;
	wakeAt?: number;
	wake?(now: number): boolean;
}
export interface Condition {
	create(startedAt: number): ConditionState;
}

export function sequence(...conditions: readonly Condition[]): Condition {
	if (!conditions.length)
		throw new InvalidOptionsError('A transition requires at least one condition');
	return Object.freeze<Condition>({
		create(startedAt) {
			let index = 0,
				current = conditions[0]!.create(startedAt);
			let latest: Observation | undefined;
			return {
				baseline(observation) {
					latest = observation;
					current.baseline?.(observation);
				},
				observe(observation) {
					latest = observation;
					if (current.observe(observation)) {
						index++;
						if (index === conditions.length) return true;
						current = conditions[index]!.create(observation.timestamp);
						current.baseline?.(observation);
					}
					return false;
				},
				get wakeAt() {
					return current.wakeAt;
				},
				wake(now) {
					if (!current.wake?.(now)) return false;
					index++;
					if (index === conditions.length) return true;
					current = conditions[index]!.create(now);
					if (latest) current.baseline?.(latest);
					return false;
				},
			};
		},
	});
}
/** Explicit elapsed-time capture. Prefer a visible completion condition. */
export function elapsed(milliseconds: number): Condition {
	duration(milliseconds);
	return Object.freeze<Condition>({
		create: (started) => ({
			observe: () => false,
			wakeAt: started + milliseconds,
			wake: (now) => now >= started + milliseconds,
		}),
	});
}
function duration(milliseconds: number): void {
	if (!Number.isFinite(milliseconds) || milliseconds < 0)
		throw new InvalidOptionsError('Duration must be nonnegative and finite');
}
/** Defaults to region contents; unrelated screen animation cannot reset it. */
// oxlint-disable-next-line bombshell-dev/max-params -- query, interval, and independent stability dimension
export function settled(
	locator: RegionLocator,
	milliseconds = 100,
	kind: 'region' | 'geometry' = 'region',
): Condition {
	duration(milliseconds);
	return Object.freeze<Condition>({
		create(startedAt) {
			let key: string | undefined,
				wakeAt: number | undefined,
				screenSequence: number | undefined,
				pending = false;
			return {
				baseline(observation) {
					this.observe(observation);
					if (wakeAt !== undefined) wakeAt = startedAt + milliseconds;
				},
				get wakeAt() {
					return pending ? undefined : wakeAt;
				},
				observe(observation) {
					if (!locator.accepts(observation)) {
						if (observation.screen.sequence !== screenSequence) pending = true;
						return false;
					}
					pending = false;
					screenSequence = observation.screen.sequence;
					const matches = locator.resolve(observation);
					if (matches.length > 1)
						throw new StrictLocatorError(`Ambiguous locator: ${locator.source}`);
					const next = matches[0]
						? kind === 'geometry'
							? JSON.stringify(matches[0].bounds)
							: matches[0].visualKey()
						: undefined;
					if (next === undefined) {
						key = undefined;
						wakeAt = undefined;
						return false;
					}
					if (next !== key) {
						key = next;
						wakeAt = observation.timestamp + milliseconds;
					}
					return wakeAt !== undefined && observation.timestamp >= wakeAt;
				},
				wake: (now) => !pending && wakeAt !== undefined && now >= wakeAt,
			};
		},
	});
}

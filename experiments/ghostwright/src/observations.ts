import { GhostwrightError } from './errors.ts';
import type { ScreenSnapshot } from './types.ts';

export interface ScreenObservation {
	readonly kind: 'screen';
	readonly sequence: number;
	readonly timestamp: number;
	readonly screen: ScreenSnapshot;
}
export interface DescribedObservation<T = unknown> {
	readonly kind: 'extension';
	readonly sequence: number;
	readonly timestamp: number;
	readonly screen: ScreenSnapshot;
	readonly extensionId: string;
	readonly protocolFrame: number;
	readonly description: T;
}
export interface InvalidObservation {
	readonly kind: 'extension-error';
	readonly sequence: number;
	readonly timestamp: number;
	readonly screen: ScreenSnapshot;
	readonly extensionId: string;
	readonly error: Error;
}
export type Observation = ScreenObservation | DescribedObservation | InvalidObservation;

/** Descriptions cross an ownership boundary here. Never retain mutable producer state. */
export function immutable<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		if (ArrayBuffer.isView(value))
			throw new GhostwrightError({
				code: 'GW_EXTENSION_DATA',
				message: 'Descriptions must contain immutable data, not typed arrays',
			});
		Object.freeze(value);
		for (const child of Object.values(value)) immutable(child);
	}
	return value;
}

/** Session-owned ordering. Active captures own their retention, independently of screen history. */
export class Observations {
	#sequence = 0;
	#latest: Observation;
	#extensions = new Map<string, DescribedObservation | InvalidObservation>();
	#listeners = new Set<(observation: Observation) => void>();
	constructor(screen: ScreenSnapshot) {
		this.#latest = Object.freeze({
			kind: 'screen',
			sequence: 0,
			timestamp: performance.now(),
			screen,
		});
	}
	current(extensionId?: string): Observation | undefined {
		if (extensionId === undefined) return this.#latest;
		const paired = this.#extensions.get(extensionId);
		return paired?.screen.sequence === this.#latest.screen.sequence ? paired : undefined;
	}
	get sequence() {
		return this.#sequence;
	}
	subscribe(listener: (observation: Observation) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	screen(screen: ScreenSnapshot): ScreenObservation {
		const observation: ScreenObservation = Object.freeze({
			kind: 'screen',
			sequence: ++this.#sequence,
			timestamp: performance.now(),
			screen,
		});
		this.#publish(observation);
		return observation;
	}
	// oxlint-disable-next-line bombshell-dev/max-params -- publication fixes protocol identity and paired evidence
	describe<T>(
		extensionId: string,
		protocolFrame: number,
		description: T,
		screen: ScreenSnapshot,
	): DescribedObservation<T> {
		const observation: DescribedObservation<T> = Object.freeze({
			kind: 'extension',
			sequence: ++this.#sequence,
			timestamp: performance.now(),
			extensionId,
			protocolFrame,
			description: immutable(structuredClone(description)),
			screen,
		});
		this.#extensions.set(extensionId, observation);
		this.#publish(observation);
		return observation;
	}
	// oxlint-disable-next-line bombshell-dev/max-params -- invalid evidence still retains its identity and screen
	invalid(extensionId: string, error: Error, screen: ScreenSnapshot): void {
		const observation: InvalidObservation = Object.freeze({
			kind: 'extension-error',
			sequence: ++this.#sequence,
			timestamp: performance.now(),
			extensionId,
			error,
			screen,
		});
		this.#extensions.set(extensionId, observation);
		this.#publish(observation);
	}
	#publish(observation: Observation): void {
		this.#latest = observation;
		// oxlint-disable-next-line unicorn/no-useless-spread -- listeners may subscribe or unsubscribe while dispatching
		for (const listener of [...this.#listeners]) listener(observation);
	}
}

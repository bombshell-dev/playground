import { ExtensionOscLimitError } from '../errors.ts';
import type { OscRegistration, RegisteredOscMessage } from '../types.ts';

export interface OscEvent {
	registration: OscRegistration<unknown>;
	message: RegisteredOscMessage;
}

export type OscStreamItem =
	| { kind: 'ordinary'; bytes: Uint8Array }
	| { kind: 'event'; event: OscEvent }
	| { kind: 'error'; error: Error; registration: OscRegistration<unknown> };

export interface OscStreamResult {
	items: readonly OscStreamItem[];
}

function bytes(parts: readonly number[]): Uint8Array {
	return Uint8Array.from(parts);
}

/**
 * Ordered byte-stream parser for registered OSC messages. A possible escape
 * sequence stays in the current ordinary host-frame buffer until it is proven
 * to be a registered OSC, so installing an extension cannot subdivide normal
 * CSI/unregistered-OSC output into additional terminal revisions.
 */
export class RegisteredOscStream {
	#state: 'normal' | 'escape' | 'osc' | 'discarding' = 'normal';
	#candidate: number[] = [];
	#registration?: OscRegistration<unknown>;
	#discardPreviousEscape = false;

	constructor(readonly registrations: readonly OscRegistration<unknown>[]) {}

	push(input: Uint8Array): OscStreamResult {
		const items: OscStreamItem[] = [];
		let ordinary: number[] = [];
		const flush = (): void => {
			if (ordinary.length) items.push({ kind: 'ordinary', bytes: bytes(ordinary) });
			ordinary = [];
		};
		const releaseCandidate = (): void => {
			ordinary.push(...this.#candidate);
			this.#candidate = [];
			this.#state = 'normal';
		};
		for (const byte of input) {
			if (this.#state === 'discarding') {
				if (byte === 0x07 || (this.#discardPreviousEscape && byte === 0x5c)) {
					this.#state = 'normal';
					this.#discardPreviousEscape = false;
				} else {
					this.#discardPreviousEscape = byte === 0x1b;
				}
				continue;
			}
			if (this.#state === 'normal') {
				if (byte === 0x1b) {
					this.#candidate = [byte];
					this.#state = 'escape';
				} else {
					ordinary.push(byte);
				}
				continue;
			}
			if (this.#state === 'escape') {
				this.#candidate.push(byte);
				if (byte === 0x5d) this.#state = 'osc';
				else releaseCandidate();
				continue;
			}

			this.#candidate.push(byte);
			if (!this.#registration) {
				const prefix = Buffer.from(this.#candidate).toString('latin1');
				this.#registration = this.registrations.find(
					(entry) => prefix === `\u001b]${entry.number};${entry.namespace};`,
				);
				if (!this.#registration) {
					if (
						!this.registrations.some((entry) =>
							`\u001b]${entry.number};${entry.namespace};`.startsWith(prefix),
						)
					)
						releaseCandidate();
					continue;
				}
			}
			const registration = this.#registration;
			const length = this.#candidate.length;
			const st = length >= 2 && this.#candidate[length - 2] === 0x1b && byte === 0x5c;
			const bel = byte === 0x07;
			if (length > registration.maxBufferedBytes) {
				// Do not return to ordinary parsing here: every byte through the OSC
				// terminator belongs to the rejected registered sequence.
				flush();
				items.push({
					kind: 'error',
					registration,
					error: new ExtensionOscLimitError(
						`Registered OSC ${registration.number};${registration.namespace} exceeded ${registration.maxBufferedBytes} buffered bytes`,
					),
				});
				this.#candidate = [];
				this.#registration = undefined;
				this.#state = st || bel ? 'normal' : 'discarding';
				this.#discardPreviousEscape = byte === 0x1b;
				continue;
			}
			if (!st && !bel) continue;
			const prefix = `\u001b]${registration.number};${registration.namespace};`;
			const body = Buffer.from(
				this.#candidate.slice(prefix.length, length - (st ? 2 : 1)),
			).toString('latin1');
			const parts = body.split(';');
			const payload = parts.pop() ?? '';
			// This is the one intentional split: preceding visual bytes must be
			// committed before the semantic extension event at this exact boundary.
			flush();
			items.push({
				kind: 'event',
				event: {
					registration,
					message: Object.freeze({
						number: registration.number,
						namespace: registration.namespace,
						parameters: Object.freeze(parts),
						payload: Buffer.from(payload, 'latin1'),
						terminator: st ? 'ST' : 'BEL',
					}),
				},
			});
			this.#candidate = [];
			this.#registration = undefined;
			this.#state = 'normal';
		}
		flush();
		return { items };
	}
}

import { ExtensionDuplicateError, GhostwrightError } from '../errors.ts';
import { Observations } from '../observations.ts';
import type { ScreenSnapshot, TerminalExtensionDefinition } from '../types.ts';
import { RegisteredOscStream } from './extensions.ts';

/** The shared live/replay boundary. Descriptions never write terminal cells. */
export class TerminalOutput {
	readonly observations: Observations;
	#osc: RegisteredOscStream;
	#frames = new Map<string, number>();
	readonly extensions: readonly TerminalExtensionDefinition[];
	private readonly current: () => ScreenSnapshot;
	private readonly ordinary: (bytes: Uint8Array) => ScreenSnapshot;
	private readonly diagnostic: (error: Error) => void;
	// oxlint-disable-next-line bombshell-dev/max-params -- internal live/replay wiring
	constructor(
		extensions: readonly TerminalExtensionDefinition[],
		current: () => ScreenSnapshot,
		ordinary: (bytes: Uint8Array) => ScreenSnapshot,
		diagnostic: (error: Error) => void = () => {},
	) {
		this.extensions = extensions;
		this.current = current;
		this.ordinary = ordinary;
		this.diagnostic = diagnostic;
		const ids = new Set(extensions.map((extension) => extension.id));
		const registrations = new Set(
			extensions.map((extension) => `${extension.osc.number};${extension.osc.namespace}`),
		);
		if (ids.size !== extensions.length || registrations.size !== extensions.length)
			throw new ExtensionDuplicateError('Duplicate extension id or OSC registration');
		this.#osc = new RegisteredOscStream(extensions.map((extension) => extension.osc));
		this.observations = new Observations(current());
	}
	push(bytes: Uint8Array): void {
		for (const item of this.#osc.push(bytes).items) {
			if (item.kind === 'ordinary') {
				this.observations.screen(this.ordinary(item.bytes));
				continue;
			}
			const registration = item.kind === 'event' ? item.event.registration : item.registration;
			const extension = this.extensions.find((extension) => extension.osc === registration)!;
			try {
				if (item.kind === 'error') throw item.error;
				const commit = extension.osc.decode(item.event.message);
				const previous = this.#frames.get(extension.id) ?? 0;
				if (!Number.isSafeInteger(commit.protocolFrame) || commit.protocolFrame !== previous + 1)
					throw new GhostwrightError({
						code: 'GW_EXTENSION_FRAME',
						message: `${extension.id}: frame ${commit.protocolFrame} does not follow ${previous}`,
					});
				this.#frames.set(extension.id, commit.protocolFrame);
				this.observations.describe(
					extension.id,
					commit.protocolFrame,
					commit.value,
					this.current(),
				);
			} catch (cause) {
				const error = cause instanceof Error ? cause : new Error(String(cause));
				this.observations.invalid(extension.id, error, this.current());
				this.diagnostic(error);
			}
		}
	}
}

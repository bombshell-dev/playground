import { createInput, type InputEvent, type ScanResult } from '@bomb.sh/tty';
import type { ReadStream } from 'node:tty';
import { on } from 'node:events';

export interface InputLoopOptions {
	stdin: ReadStream;
	signal: AbortSignal;
}

export type Outcome =
	| {
			type: 'end';
	  }
	| {
			type: 'error';
			error: Error;
	  };

export function createInputLoop(options: InputLoopOptions): AsyncIterable<InputEvent[]> {
	const { stdin, signal } = options;

	return {
		async *[Symbol.asyncIterator]() {
			const scanner = await abortable(signal, createInput());
			if (scanner.type === 'aborted') {
				return;
			}

			const { scan } = scanner.value;

			const data = on(stdin, 'data', {
				signal,
				close: ['end'],
			});

			let read = data.next();
			let pending: Pending;

			try {
				while (true) {
					const winner = await race(read, pending);
					if (winner.done) {
						break;
					}
					const { value: event } = winner;

					if (event.type === 'data') {
						// move to the next chunk if this chunk wins.
						read = data.next();
						const result = scan(event.data);
						pending = result.pending;

						if (result.events.length > 0) {
							yield result.events;
						}
					} else {
						// `read` is still pending and must race again
						const result = scan();
						pending = result.pending;

						if (result.events.length > 0) {
							yield result.events;
						}
					}
				}
			} catch (error) {
				if (signal.aborted && error instanceof Error && error.name === 'AbortError') {
					return;
				}
				throw error;
			} finally {
				data.return?.();
			}
		},
	};
}

async function race(
	read: Promise<IteratorResult<unknown[]>>,
	pending: Pending,
): Promise<IteratorResult<ReadEvent>> {
	let timeoutId: NodeJS.Timeout | undefined = undefined;
	const timeout = pending
		? new Promise<IteratorResult<ReadEvent>>((resolve) => {
				timeoutId = setTimeout(
					() => resolve({ done: false, value: { type: 'timeout' } }),
					pending.delay,
				);
			})
		: new Promise<IteratorResult<ReadEvent>>(() => {});

	const data = read.then((item): IteratorResult<ReadEvent> => {
		if (item.done) return { done: true, value: undefined };
		const [chunk] = item.value;
		if (!Buffer.isBuffer(chunk)) throw new InvalidInputChunkError();
		return { done: false, value: { type: 'data', data: chunk } };
	});

	try {
		return await Promise.race([data, timeout]);
	} finally {
		clearTimeout(timeoutId);
	}
}

class InvalidInputChunkError extends TypeError {
	constructor() {
		super('Terminal input must emit Buffer chunks; do not set a text encoding on stdin');
		this.name = 'InvalidInputChunkError';
	}
}

type Pending = ScanResult['pending'];

type ReadEvent = DataEvent | TimeoutEvent;

type DataEvent = {
	type: 'data';
	data: Buffer;
};

type TimeoutEvent = {
	type: 'timeout';
};

type Abortable<T> =
	| {
			type: 'aborted';
	  }
	| {
			type: 'resolved';
			value: T;
	  };

async function abortable<T>(signal: AbortSignal, op: Promise<T>): Promise<Abortable<T>> {
	if (signal.aborted) {
		return { type: 'aborted' };
	}
	let listener: (() => void) | undefined;
	try {
		return await Promise.race([
			op.then<Abortable<T>>((value) => ({ type: 'resolved', value })),
			new Promise<Abortable<T>>((resolve) => {
				signal.addEventListener('abort', (listener = () => resolve({ type: 'aborted' })));
			}),
		]);
	} finally {
		if (listener) {
			signal.removeEventListener('abort', listener);
		}
	}
}

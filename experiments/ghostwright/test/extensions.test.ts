import { expect, test } from 'bun:test';
import { RegisteredOscStream } from '../src/terminal/extensions.ts';
import type { OscRegistration } from '../src/types.ts';

const registration: OscRegistration<string> = {
	number: 7777,
	namespace: 'test.semantic',
	maxBufferedBytes: 1024,
	decode: (message) => new TextDecoder().decode(message.payload),
};
const frame = new TextEncoder().encode('\u001b]7777;test.semantic;v=1;payload\u001b\\');

function events(items: ReturnType<RegisteredOscStream['push']>['items']) {
	return items.filter((item) => item.kind === 'event');
}

test('registered OSC accepts every PTY split boundary without partial commits', () => {
	for (let split = 1; split < frame.length; split++) {
		const stream = new RegisteredOscStream([registration]);
		expect(events(stream.push(frame.slice(0, split)).items)).toHaveLength(0);
		const committed = events(stream.push(frame.slice(split)).items);
		expect(committed).toHaveLength(1);
		const event = committed[0];
		if (event?.kind === 'event') {
			expect(event.event.message.parameters).toEqual(['v=1']);
			expect(new TextDecoder().decode(event.event.message.payload)).toBe('payload');
		}
	}
});

test('registered OSC retains visual/commit ordering inside one PTY host frame', () => {
	const stream = new RegisteredOscStream([registration]);
	const input = new TextEncoder().encode(`before${new TextDecoder().decode(frame)}after`);
	const items = stream.push(input).items;
	expect(items.map((item) => item.kind)).toEqual(['ordinary', 'event', 'ordinary']);
	expect(new TextDecoder().decode((items[0] as { bytes: Uint8Array }).bytes)).toBe('before');
	expect(new TextDecoder().decode((items[2] as { bytes: Uint8Array }).bytes)).toBe('after');
});

test('oversized registered OSC discards its complete payload through ST', () => {
	const stream = new RegisteredOscStream([{ ...registration, maxBufferedBytes: 24 }]);
	const items = stream.push(
		new TextEncoder().encode(
			'\u001b]7777;test.semantic;v=1;THIS_SHOULD_NOT_REACH_TERMINAL\u001b\\VISIBLE',
		),
	).items;
	expect(items.map((item) => item.kind)).toEqual(['error', 'ordinary']);
	expect(new TextDecoder().decode((items[1] as { bytes: Uint8Array }).bytes)).toBe('VISIBLE');
});

test('ordinary ANSI output remains one ordinary host-frame item', () => {
	const stream = new RegisteredOscStream([registration]);
	const items = stream.push(new TextEncoder().encode('a\u001b[31mb')).items;
	expect(items).toHaveLength(1);
	expect(items[0]?.kind).toBe('ordinary');
	if (items[0]?.kind === 'ordinary')
		expect(new TextDecoder().decode(items[0].bytes)).toBe('a\u001b[31mb');
});

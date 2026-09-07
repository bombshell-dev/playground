import { expect, test } from 'bun:test';
import {
	defineLocator,
	launchTerminal,
	regionLocator,
	textLocator,
	type TerminalExtensionDefinition,
} from '../src/index.ts';

interface Frame {
	frame: number;
	count: number;
}
const extension: TerminalExtensionDefinition<Frame> = {
	id: 'query.fixture',
	osc: {
		number: 7777,
		namespace: 'query.fixture',
		maxBufferedBytes: 4096,
		decode(message) {
			const value: Frame = JSON.parse(new TextDecoder().decode(message.payload));
			return { protocolFrame: value.frame, value };
		},
	},
};
const targets = defineLocator<Frame>('query.fixture', 'target', (frame) =>
	Array.from({ length: frame.count }, (_, index) => ({
		column: index * 7,
		row: 1,
		width: 6,
		height: 1,
	})),
);
const options = {
	command: process.execPath,
	args: [
		'-e',
		String.raw`
		process.stdin.setRawMode(true);
		let frame = 0;
		function paint(count) {
			process.stdout.write('\x1b[2J\x1b[HREADY\r\n' + 'target '.repeat(count) +
				'\x1b]7777;query.fixture;v=1;' + JSON.stringify({frame: ++frame, count}) + '\x1b\\');
		}
		process.stdin.on('data', bytes => {
			for (const key of bytes.toString()) {
				if (key === 'x') process.exit(0);
				else if (key === 's') process.stdout.write('\x1b[2J\x1b[HUNPAIRED');
				else paint(Number(key));
			}
		});
		paint(0);
	`,
	],
	extensions: [extension],
	selector: (_source: string) => targets,
	trace: 'off' as const,
};

for (const kind of ['recipe', 'text', 'selector'] as const) {
	test(`${kind} queries share cardinality, waiting, and frozen evidence`, async () => {
		await using terminal = await launchTerminal(options);
		const { screen, keyboard, waitFor } = terminal;
		await screen.findByText('READY');
		await waitFor(() => screen.queryAllBy(targets));
		const get = (): ReturnType<typeof screen.getBy> =>
			kind === 'recipe'
				? screen.getBy(targets)
				: kind === 'text'
					? screen.getByText('target')
					: screen.getBySelector('target');
		const query = (): ReturnType<typeof screen.queryBy> =>
			kind === 'recipe'
				? screen.queryBy(targets)
				: kind === 'text'
					? screen.queryByText('target')
					: screen.queryBySelector('target');
		const all = (): ReturnType<typeof screen.getAllBy> =>
			kind === 'recipe'
				? screen.getAllBy(targets)
				: kind === 'text'
					? screen.getAllByText('target')
					: screen.getAllBySelector('target');
		const queryAll = (): ReturnType<typeof screen.queryAllBy> =>
			kind === 'recipe'
				? screen.queryAllBy(targets)
				: kind === 'text'
					? screen.queryAllByText('target')
					: screen.queryAllBySelector('target');
		const find = (): ReturnType<typeof screen.findBy> =>
			kind === 'recipe'
				? screen.findBy(targets)
				: kind === 'text'
					? screen.findByText('target')
					: screen.findBySelector('target');
		const findAll = (): ReturnType<typeof screen.findAllBy> =>
			kind === 'recipe'
				? screen.findAllBy(targets)
				: kind === 'text'
					? screen.findAllByText('target')
					: screen.findAllBySelector('target');

		expect(query()).toBeNull();
		expect(queryAll()).toEqual([]);
		expect(get).toThrow('No region matched');
		expect(all).toThrow('No region matched');

		const appearing = findAll();
		await keyboard.type('2');
		expect(await appearing).toHaveLength(2);
		expect(all()).toHaveLength(2);
		expect(queryAll()).toHaveLength(2);
		expect(get).toThrow('matched 2');
		expect(query).toThrow('matched 2');

		// findBy must retry ambiguity rather than selecting one or failing early.
		const unique = find();
		await keyboard.type('1');
		const saved = await unique;
		expect(saved.text()).toBe('target');
		expect(get().bounds).toEqual(saved.bounds);
		expect(query()?.bounds).toEqual(saved.bounds);
		expect(Object.isFrozen(saved)).toBe(true);
		expect(Object.isFrozen(queryAll())).toBe(true);
		await keyboard.type('0');
		await waitFor(() => expect(query()).toBeNull());
		expect(saved.text()).toBe('target');
	});
}

test('unpaired output cannot make a described control appear absent', async () => {
	await using terminal = await launchTerminal(options);
	await terminal.waitFor(() => terminal.screen.queryAllBy(targets));
	await terminal.keyboard.type('s');
	await terminal.screen.findByText('UNPAIRED');
	expect(() => terminal.screen.queryBy(targets)).toThrow('No current observation');
	expect(() => terminal.screen.queryAllBy(targets)).toThrow('No current observation');
	const following = terminal.screen.findBy(targets);
	await terminal.keyboard.type('1');
	expect((await following).text()).toBe('target');
	await terminal.keyboard.type('0');
	await terminal.waitFor(() => expect(terminal.screen.queryBy(targets)).toBeNull());
});

test('find timeouts retain the failing query and the last rendered screen', async () => {
	await using terminal = await launchTerminal(options);
	await terminal.screen.findByText('READY');
	await terminal.waitFor(() => terminal.screen.queryAllBy(targets));
	await expect(terminal.screen.findBy(targets, { timeoutMs: 20 })).rejects.toMatchObject({
		code: 'GW_WAIT_TIMEOUT',
		message: expect.stringContaining('target'),
		cause: expect.objectContaining({ code: 'GW_QUERY_MISSING' }),
	});
});

test('querying a region does not claim visibility or require a live child', async () => {
	await using terminal = await launchTerminal(options);
	await terminal.screen.findByText('READY');
	// A screen-derived input target still resolves when a description is latest.
	// This fixture has not enabled mouse reporting; hovering must not enable it.
	expect((await terminal.mouse.hover(textLocator('READY'))).bytesWritten).toBe(0);
	const unsupported = { control: true, super: true };
	await expect(terminal.mouse.hover(textLocator('READY'), unsupported)).rejects.toMatchObject({
		code: 'GW_UNSUPPORTED_MODIFIER',
	});
	const offscreen = regionLocator({ column: 200, row: 0, width: 5, height: 1 });
	expect(terminal.screen.getBy(offscreen).visibleBounds).toBeUndefined();
	await terminal.keyboard.type('x');
	await terminal.process.waitForExit();
	expect((await terminal.screen.findByText('READY')).text()).toBe('READY');
	await expect(terminal.screen.findByText('never', { timeoutMs: 20 })).rejects.toMatchObject({
		code: 'GW_WAIT_TIMEOUT',
	});
});

test('text recipes retain cell geometry for wide characters and exact matching', async () => {
	await using terminal = await launchTerminal({
		command: process.execPath,
		args: ['-e', 'process.stdout.write("界a 界a")'],
		trace: 'off',
	});
	await terminal.process.waitForExit();
	const matches = terminal.screen.getAllBy(textLocator('界a'));
	expect(matches.map((match) => match.bounds)).toEqual([
		{ column: 0, row: 0, width: 3, height: 1 },
		{ column: 4, row: 0, width: 3, height: 1 },
	]);
	expect(terminal.screen.queryByText('界a', { exact: true })).toBeNull();
	expect(terminal.screen.getByText('界a 界a', { exact: true }).bounds.width).toBe(7);
	expect(() => terminal.screen.getBySelector('anything')).toThrow('selector adapter');
	await expect(terminal.screen.findBySelector('anything')).rejects.toMatchObject({
		code: 'GW_INVALID_OPTIONS',
	});
	await expect(terminal.screen.findByText('')).rejects.toMatchObject({
		code: 'GW_INVALID_OPTIONS',
	});
});

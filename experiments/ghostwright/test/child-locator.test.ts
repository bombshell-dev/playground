import { expect, test } from 'bun:test';
import {
	defineLocator,
	defineScreenLocator,
	textContains,
	withTerminal,
	type Rect,
	type TerminalExtensionDefinition,
} from '../src/index.ts';

// Enter advances a small panel through movement, removal, and replacement.
// The child renders through a real PTY. Descriptions carry geometry, not proof
// of the text that an assertion expects to see.
const application = String.raw`
process.stdin.setRawMode(true);
const slides = [
  { column: 2, text: 'Before' },
  { column: 20, text: 'After' },
  { column: null, text: 'No panel' },
  { column: 8, text: 'Back' },
];
let index = 0;
function render() {
  const slide = slides[index];
  const bounds = slide.column === null ? null : { column: slide.column, row: 1, width: slide.text.length + 2, height: 1 };
  let output = '\x1b[2J\x1b[H' + slide.text;
  if (bounds) output += '\x1b[2;' + (bounds.column + 1) + 'H[' + slide.text + ']';
  output += '\x1b[4;1HBefore After Back'; // matching text outside the panel
  if (process.env.DESCRIBE === '1') {
    output += '\x1b]7777;panel;' + Buffer.from(JSON.stringify({ frame: index + 1, bounds })).toString('base64url') + '\x1b\\';
  }
  process.stdout.write(output);
}
process.stdin.on('data', bytes => {
  for (const key of bytes.toString()) if (key === '\r' && index < slides.length - 1) { index++; render(); }
});
render();
`;
interface Description {
	frame: number;
	bounds: Rect | null;
}
const extension: TerminalExtensionDefinition<Description> = {
	id: 'panel',
	osc: {
		number: 7777,
		namespace: 'panel',
		maxBufferedBytes: 4096,
		decode(message) {
			const value: Description = JSON.parse(
				Buffer.from(Buffer.from(message.payload).toString(), 'base64url').toString(),
			);
			return { protocolFrame: value.frame, value };
		},
	},
};

for (const described of [false, true]) {
	test(`a child follows its parent across ${described ? 'described' : 'screen'} observations`, async () => {
		const parent = described
			? defineLocator<Description>('panel', 'panel', (description) =>
					description.bounds ? [description.bounds] : [],
				)
			: defineScreenLocator('panel', (screen) =>
					screen.lines.flatMap((line) => {
						const left = line.cells.find((cell) => cell.text === '[');
						const right = line.cells.find((cell) => cell.text === ']');
						return left && right
							? [
									{
										column: left.column,
										row: line.row,
										width: right.column - left.column + 1,
										height: 1,
									},
								]
							: [];
					}),
				);
		// Construct the whole path before launching. No coordinates are captured.
		const text = parent.derive('contents', (region) => [
			{
				column: region.bounds.column + 1,
				row: region.bounds.row,
				width: region.bounds.width - 2,
				height: 1,
			},
		]);
		const initial = text.derive('initial', (region) => [{ ...region.bounds, width: 1 }]);
		const statusBounds = { column: 0, row: 0, width: 40, height: 1 };
		const status = described
			? defineLocator<Description>('panel', 'status', () => [statusBounds])
			: defineScreenLocator('status', () => [statusBounds]);

		await withTerminal(
			{
				command: process.execPath,
				args: ['-e', application],
				env: { DESCRIBE: described ? '1' : '0' },
				extensions: described ? [extension] : [],
				trace: 'off',
			},
			async (ui) => {
				await ui.expect(text).toContainText('Before');
				const movement = await ui.capture(
					{ until: text.satisfies(textContains('After')) },
					async (capture) => {
						await capture.keyboard.press('Enter');
					},
				);
				await ui.expect(initial).toContainText('A');

				// Evaluate history after the live parent has moved. Each path still
				// resolves against its supplied observation, not the current screen.
				const before = text.resolve(movement.baseline)[0]!;
				const moved = text.resolve(movement.observations.at(-1)!)[0]!;
				expect(before.text()).toBe('Before');
				expect(before.bounds.column).toBe(3);
				expect(moved.text()).toBe('After');
				expect(moved.bounds.column).toBe(21);
				expect(before.screen).toBe(parent.resolve(movement.baseline)[0]!.screen);
				expect(initial.resolve(movement.baseline)[0]!.text()).toBe('B');

				const removal = await ui.capture(
					{ until: status.satisfies(textContains('No panel')) },
					async (capture) => {
						await capture.keyboard.press('Enter');
					},
				);
				expect(text.resolve(removal.observations.at(-1)!)).toEqual([]);
				expect(initial.resolve(removal.observations.at(-1)!)).toEqual([]);

				await ui.keyboard.press('Enter');
				const restored = await ui.expect(text).toContainText('Back');
				expect(restored.bounds.column).toBe(9);
				expect(text.resolve(movement.baseline)[0]!.text()).toBe('Before');
			},
		);
	});
}

import { expect, test } from 'bun:test';
import { GhosttyWasmTerminal } from '../../src/terminal/wasm.ts';
import { type Observation, type ScreenSnapshot } from '../../src/index.ts';
import { explorerRegion, fileEntry } from './netrw.ts';

// Small rendered grids isolate the recognition rules. Ghostty still decodes
// their cells and styles; these tests do not construct pretend client results.
async function screen(
	options: {
		separator?: boolean;
		status?: boolean;
		duplicate?: boolean;
		extraBoundary?: boolean;
	} = {},
): Promise<ScreenSnapshot> {
	const terminal = await GhosttyWasmTerminal.create({
		columns: 80,
		rows: 14,
		widthPixels: 800,
		heightPixels: 280,
	});
	try {
		const rows = [
			'" =================================',
			'" Netrw Directory Listing',
			'README.md', // another decoy, in the banner rather than the file list
			'" Quick Help: <F1>:help',
			'" =================================',
			'../',
			'./',
			'README.md',
			options.duplicate ? 'README.md' : 'WELCOME.txt',
			'~',
			'~',
			'~',
		];
		const inverse = '\x1b[7m',
			reset = '\x1b[0m';
		for (const [row, text] of rows.entries()) {
			const neighbor = 'README.md'.padEnd(80 - 36 - 1);
			terminal.write(
				Buffer.from(
					`\x1b[${row + 1};1H${text.padEnd(36)}${options.separator === false ? ' ' : inverse + '|' + reset}${neighbor}`,
				),
			);
			if (options.extraBoundary)
				terminal.write(Buffer.from(`\x1b[${row + 1};61H${inverse}|${reset}`));
		}
		terminal.write(
			Buffer.from(
				`\x1b[13;1H${options.status === false ? reset : inverse}${'directory [RO]'.padEnd(36)} WELCOME.txt${reset}`,
			),
		);
		if (options.extraBoundary)
			terminal.write(Buffer.from(`\x1b[13;1H${inverse}${'directory [RO]'.padEnd(80)}${reset}`));
		return terminal.snapshot();
	} finally {
		terminal.free();
	}
}
function observation(screen: ScreenSnapshot): Observation {
	return { kind: 'screen', screen, sequence: 1, timestamp: 0 };
}

test('find a file only below the explorer banner and inside its window', async () => {
	const sample = observation(await screen());
	expect(explorerRegion.resolve(sample).map((region) => region.bounds)).toEqual([
		{ column: 0, row: 0, width: 36, height: 12 },
	]);
	expect(
		fileEntry('README.md')
			.resolve(sample)
			.map((region) => region.bounds),
	).toEqual([{ column: 0, row: 7, width: 36, height: 1 }]);
	expect(fileEntry('MISSING.md').resolve(sample)).toEqual([]);
});

test('preserve duplicate matches so strict execution cannot choose one silently', async () => {
	expect(
		fileEntry('README.md').resolve(observation(await screen({ duplicate: true }))),
	).toHaveLength(2);
});

for (const options of [{ separator: false }, { status: false }]) {
	test(`do not guess geometry when a visible boundary is missing: ${JSON.stringify(options)}`, async () => {
		expect(explorerRegion.resolve(observation(await screen(options)))).toEqual([]);
	});
}

test('ambiguous window boundaries fail instead of choosing the first one', async () => {
	const sample = observation(await screen({ extraBoundary: true }));
	expect(() => explorerRegion.resolve(sample)).toThrow('Ambiguous Vim window boundary');
});

test('reject paths and control characters rather than interpreting them as file entries', () => {
	for (const name of ['../README.md', '', 'README.md\n']) expect(() => fileEntry(name)).toThrow();
});

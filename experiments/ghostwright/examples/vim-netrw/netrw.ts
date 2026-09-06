import {
	defineScreenLocator,
	GhostwrightError,
	inspect,
	type AsyncExecution,
	type Rect,
	type RegionInspection,
	type ScreenSnapshot,
} from '../../src/index.ts';

const heading = '" Netrw Directory Listing';
const bannerRule = /^" ={3,}\s*$/;
const fail = (code: string, message: string): never => {
	throw new GhostwrightError({ code, message });
};

interface Explorer {
	readonly window: Rect;
	readonly entries: Rect;
}

/** Recognize one full-height left window in Vim's default monochrome layout. */
function leftWindow(screen: ScreenSnapshot): Rect | undefined {
	const candidates: Rect[] = [];
	for (const cell of screen.lines[0]?.cells ?? []) {
		if (cell.column === 0 || cell.column >= screen.viewport.columns - 1) continue;
		const isSeparator = (row: number) => {
			const candidate = screen.lines[row]?.cells[cell.column];
			return (
				candidate?.style.inverse &&
				!candidate.style.invisible &&
				['|', '│'].includes(candidate.text)
			);
		};
		if (!isSeparator(0)) continue;
		let bottom = 0;
		while (bottom < screen.viewport.rows && isSeparator(bottom)) bottom++;
		// The separator ends at a reverse-video statusline, not at a gap in text.
		const status = screen.lines[bottom]?.cells.slice(0, cell.column);
		if (
			bottom !== screen.viewport.rows - 2 ||
			status?.length !== cell.column ||
			!status.every((cell) => cell.style.inverse && !cell.style.invisible)
		)
			continue;
		candidates.push({ column: 0, row: 0, width: cell.column, height: bottom });
	}
	if (candidates.length > 1) fail('GW_VIM_LAYOUT_AMBIGUOUS', 'Ambiguous Vim window boundary');
	return candidates[0];
}

/** The listing starts below the banner and ends before the window's statusline. */
function listingBounds(window: RegionInspection): Rect | undefined {
	const rows = window.text().split('\n');
	const titles = rows.flatMap((text, row) => (text.trimEnd().startsWith(heading) ? [row] : []));
	if (titles.length > 1) fail('GW_VIM_LAYOUT_AMBIGUOUS', 'Ambiguous netrw heading');
	const title = titles[0];
	if (title === undefined || title === 0 || !bannerRule.test(rows[title - 1]!)) return undefined;
	const closingRule = rows.findIndex((text, row) => row > title && bannerRule.test(text));
	if (closingRule === -1) return undefined;
	return {
		column: window.bounds.column,
		row: window.bounds.row + closingRule + 1,
		width: window.bounds.width,
		height: window.bounds.height - closingRule - 1,
	};
}

/** Find the banner and listing within the same immutable screen. */
function explorer(screen: ScreenSnapshot): Explorer | undefined {
	const window = leftWindow(screen);
	if (!window) return undefined;
	const entries = listingBounds(inspect(screen).region(window));
	return entries ? { window, entries } : undefined;
}

/** A live query for the explorer, derived only from painted cells. */
export const explorerRegion = defineScreenLocator(
	'netrw explorer (left split, visible banner and statusline)',
	(screen) => {
		const found = explorer(screen);
		return found ? [found.window] : [];
	},
);

const listingRegion = explorerRegion.derive('listing', (window) => {
	const bounds = listingBounds(window);
	return bounds ? [bounds] : [];
});

/** Thin-list entries with plain ASCII filenames; never a path or a Vim command. */
export function fileEntry(name: string) {
	if (!name || /[^A-Za-z0-9_.-]/.test(name))
		fail('GW_VIM_FILENAME', 'Use a plain ASCII filename, not a path or command');
	return listingRegion.derive(`file ${JSON.stringify(name)} (visible thin-list entry)`, (listing) =>
		listing
			.text()
			.split('\n')
			.flatMap((text, row) =>
				text.trimEnd() === name
					? [
							{
								column: listing.bounds.column,
								row: listing.bounds.row + row,
								width: listing.bounds.width,
								height: 1,
							},
						]
					: [],
			),
	);
}

function editorFor(name: string) {
	return defineScreenLocator(
		`Vim editor for ${JSON.stringify(name)} in the left split`,
		(screen) => {
			const window = leftWindow(screen);
			if (!window || explorer(screen)) return [];
			const status = inspect(screen)
				.region({ column: window.column, row: window.height, width: window.width, height: 1 })
				.text()
				.trim();
			// Read the actual statusline. A matching string in buffer contents is not a filename.
			const displayedPath = status.split(/\s+/)[0] ?? '';
			return displayedPath.split('/').at(-1) === name ? [window] : [];
		},
	);
}

/** Small authored control model. Recognition is pure; actions use its owning executor. */
export function netrw(ui: AsyncExecution) {
	return Object.freeze({
		region: explorerRegion,
		find(name: string) {
			const region = fileEntry(name);
			const editor = editorFor(name);
			return Object.freeze({
				region,
				editor,
				async open(): Promise<RegionInspection> {
					const target = await ui.assert(region, (actual) => ({
						pass: actual.screen.cursor.visible,
						expected: 'visible normal-mode cursor before navigating',
						actual: actual.screen.cursor,
					}));
					const bounds = explorer(target.screen)!.entries;
					const cursor = target.screen.cursor;
					if (!inspect(target.screen).region(bounds).cursor().inside)
						fail('GW_VIM_FOCUS', 'Move the cursor into the netrw listing before opening a file');
					const distance = target.bounds.row - cursor.row;
					if (distance !== 0)
						await ui.keyboard.type(`${Math.abs(distance)}${distance > 0 ? 'j' : 'k'}`);
					// Resolve again after movement. Do not press Enter until the cursor
					// visibly belongs to the intended entry in the current screen.
					await ui.expect(region).toContainCursor({ visible: true });
					await ui.keyboard.press('Enter');
					return ui.expect(editor).toContainCursor({ visible: true });
				},
			});
		},
	});
}

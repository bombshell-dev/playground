import type { RegionLocator } from './locators.ts';
import type { ActionReceipt, AsyncTerminal, MouseOptions, Point } from './types.ts';
import type { RegionInspection } from './inspection.ts';
import type { Matcher } from './matchers.ts';

export type MouseTarget = Point | RegionLocator;
export interface DragOffset {
	readonly by: { readonly columns: number; readonly rows: number };
}
export interface LocatedMouse {
	move(target: MouseTarget, options?: MouseOptions): Promise<ActionReceipt>;
	hover(target: MouseTarget, options?: MouseOptions): Promise<ActionReceipt>;
	down(target: MouseTarget, options?: MouseOptions): Promise<ActionReceipt>;
	up(target: MouseTarget, options?: MouseOptions): Promise<ActionReceipt>;
	click(target: MouseTarget, options?: MouseOptions): Promise<ActionReceipt>;
	doubleClick(target: MouseTarget, options?: MouseOptions): Promise<ActionReceipt>;
	drag(
		start: MouseTarget,
		destination: Point | DragOffset,
		options?: MouseOptions,
	): Promise<ActionReceipt>;
	wheel: AsyncTerminal['mouse']['wheel'];
}

/** Resolve a recipe once per action. Input encoding remains owned by the terminal. */
export function locatedMouse(
	mouse: AsyncTerminal['mouse'],
	assert: (locator: RegionLocator, matcher: Matcher) => Promise<RegionInspection>,
): LocatedMouse {
	const point = async (target: MouseTarget): Promise<Point> => {
		if (!('resolve' in target)) return target;
		const region = await assert(target, (actual) => ({
			pass: !!actual.visibleBounds,
			expected: 'on-screen region',
			actual: actual.bounds,
		}));
		const bounds = region.visibleBounds!;
		return {
			column: bounds.column + Math.floor((bounds.width - 1) / 2),
			row: bounds.row + Math.floor((bounds.height - 1) / 2),
		};
	};
	const move = async (target: MouseTarget, options?: MouseOptions): Promise<ActionReceipt> =>
		mouse.move(await point(target), options);
	return Object.freeze<LocatedMouse>({
		move,
		hover: move,
		down: async (target, options) => mouse.down(await point(target), options),
		up: async (target, options) => mouse.up(await point(target), options),
		click: async (target, options) => mouse.click(await point(target), options),
		doubleClick: async (target, options) => mouse.doubleClick(await point(target), options),
		drag: async (target, destination, options) => {
			const start = await point(target);
			const end =
				'by' in destination
					? { column: start.column + destination.by.columns, row: start.row + destination.by.rows }
					: destination;
			// Resolve the start once; never chase the moving divider during a drag.
			return mouse.drag(start, end, options);
		},
		wheel: mouse.wheel,
	});
}

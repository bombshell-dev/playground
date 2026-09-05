import {
	all,
	createExpect,
	cursorInside,
	defineMatchers,
	edgeHasStyle,
	textHasStyle,
	type RegionInspection,
} from 'ghostwright';

/** Clack's visual contracts. These consume terminal evidence, never node state. */
export const clackMatchers = defineMatchers({
	toHaveInputFocus(actual: RegionInspection) {
		return all(
			edgeHasStyle('top', { foreground: '#ffffff' }),
			edgeHasStyle('bottom', { foreground: '#ffffff' }),
			edgeHasStyle('left', { foreground: '#ffffff' }),
			edgeHasStyle('right', { foreground: '#ffffff' }),
			cursorInside({ visible: true }),
		)(actual);
	},
	toHaveButtonFocus(actual: RegionInspection, label: string) {
		return textHasStyle(label, { foreground: '#ffffff' })(actual);
	},
});
export const expectUI = createExpect().extend(clackMatchers);

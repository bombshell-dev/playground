import type {
	AssertionOptions,
	LocatorMatch,
	ScreenRevision,
	ScreenSnapshot,
	StableAssertionOptions,
	StyleQuery,
	TransientAssertionOptions,
} from '../types.ts';
export interface AsyncLocatorExpectation {
	toBePresent(options?: AssertionOptions): Promise<LocatorMatch>;
	toBeAbsent(options?: StableAssertionOptions): Promise<void>;
	toBeStable(options?: StableAssertionOptions): Promise<LocatorMatch>;
	toHaveStyle(style: StyleQuery, options?: AssertionOptions): Promise<LocatorMatch>;
	toContainCursor(options?: AssertionOptions): Promise<LocatorMatch>;
}
export interface AsyncTerminalExpectation {
	toSatisfy(
		predicate: (snapshot: ScreenSnapshot) => boolean,
		options?: StableAssertionOptions,
	): Promise<ScreenSnapshot>;
	toHaveShown(
		predicate: (snapshot: ScreenSnapshot) => boolean,
		options?: TransientAssertionOptions,
	): Promise<ScreenRevision>;
	toHaveShownText(text: string, options?: TransientAssertionOptions): Promise<ScreenRevision>;
}

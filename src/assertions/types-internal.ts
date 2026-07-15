import type {
  AssertionOptions,
  LocatorMatch,
  ScreenRevision,
  StableAssertionOptions,
  TransientAssertionOptions,
} from "../types.ts";
export interface AsyncLocatorExpectation {
  toBePresent(options?: AssertionOptions): Promise<LocatorMatch>;
  toBeAbsent(options?: StableAssertionOptions): Promise<void>;
  toBeStable(options?: StableAssertionOptions): Promise<LocatorMatch>;
}
export interface AsyncTerminalExpectation {
  toHaveShownText(text: string, options?: TransientAssertionOptions): Promise<ScreenRevision>;
}

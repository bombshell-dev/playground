import { call, type Operation } from 'effection';
import type {
	AssertionOptions,
	ActionReceipt,
	KeyName,
	HistoryQuery,
	HistorySearchOptions,
	KeyPress,
	LocatorMatch,
	MouseOptions,
	RevisionCollectionOptions,
	OperationLocator,
	OperationRegion,
	OperationTerminal,
	Point,
	Rect,
	StableAssertionOptions,
	ScreenRevision,
	ScreenSnapshot,
	StyleQuery,
	TerminalLaunchOptions,
	TextLocatorOptions,
	TraceableInputOptions,
	TransientAssertionOptions,
	Viewport,
	WheelOptions,
} from '../types.ts';
import { expectTerminal as expectAsync } from '../assertions/index.ts';
import type { Locator } from '../terminal/session.ts';
import {
	execution,
	useSession,
	assertRegion,
	captureOperation,
	type CaptureOptions,
	type AsyncExecution,
} from '../execution.ts';
import { createExpect, type Matcher } from '../matchers.ts';
import { recordFailure, recordSuccess } from '../tracing/outcome.ts';
import type { ScreenQueries } from '../queries.ts';
import type { WaitForOptions } from '../wait-for.ts';
import type { MouseTarget, DragOffset } from '../mouse.ts';
type OperationQueries = {
	[K in keyof ScreenQueries]: ScreenQueries[K] extends (...args: infer A) => Promise<infer R>
		? (...args: A) => Operation<R>
		: ScreenQueries[K];
};
import type { RegionLocator } from '../locators.ts';
const expectRegion = createExpect();
const op = <T>(fn: () => Promise<T>): Operation<T> => call(fn);
/** Effection wrapper around an async Locator. */
export class EffectionLocator implements OperationLocator {
	constructor(readonly inner: Locator) {}
	nth(i: number): EffectionLocator {
		return new EffectionLocator(this.inner.nth(i));
	}
	region(r: Rect): EffectionLocator {
		return new EffectionLocator(this.inner.region(r));
	}
	matches(): readonly LocatorMatch[] {
		return this.inner.matches();
	}
	click(o?: MouseOptions): Operation<ActionReceipt> {
		return op(() => this.inner.click(o));
	}
}
/** Effection wrapper around a TerminalSession. */
export class EffectionTerminal implements OperationTerminal {
	constructor(readonly inner: AsyncExecution) {}
	get signal(): AbortSignal {
		return this.inner.signal;
	}
	assert(locator: RegionLocator, matcher: Matcher): ReturnType<typeof assertRegion> {
		return assertRegion(this.inner.session, locator, matcher);
	}
	expect(locator: RegionLocator): ReturnType<typeof expectRegion.operation> {
		return expectRegion.operation(this, locator);
	}
	waitFor = <T>(callback: () => T | PromiseLike<T>, options?: WaitForOptions): Operation<T> =>
		op(() => this.inner.waitFor(callback, options));
	capture(
		options: CaptureOptions,
		body: (terminal: EffectionTerminal) => Operation<unknown>,
	): ReturnType<typeof captureOperation> {
		return captureOperation(this.inner.session, options, (terminal) =>
			body(new EffectionTerminal(terminal)),
		);
	}
	keyboard = {
		press: (k: KeyName | KeyPress) => op(() => this.inner.keyboard.press(k)),
		type: (t: string, o?: TraceableInputOptions) => op(() => this.inner.keyboard.type(t, o)),
		paste: (t: string, o?: TraceableInputOptions) => op(() => this.inner.keyboard.paste(t, o)),
		focus: (s: 'in' | 'out') => op(() => this.inner.keyboard.focus(s)),
		write: (d: Uint8Array) => op(() => this.inner.keyboard.write(d)),
	};
	mouse = {
		move: (p: MouseTarget, o?: MouseOptions) => op(() => this.inner.mouse.move(p, o)),
		hover: (p: MouseTarget, o?: MouseOptions) => op(() => this.inner.mouse.hover(p, o)),
		down: (p: MouseTarget, o?: MouseOptions) => op(() => this.inner.mouse.down(p, o)),
		up: (p: MouseTarget, o?: MouseOptions) => op(() => this.inner.mouse.up(p, o)),
		click: (p: MouseTarget, o?: MouseOptions) => op(() => this.inner.mouse.click(p, o)),
		doubleClick: (p: MouseTarget, o?: MouseOptions) => op(() => this.inner.mouse.doubleClick(p, o)),
		// oxlint-disable-next-line bombshell-dev/max-params -- wraps mouse.drag(start, end, options) API
		drag: (a: MouseTarget, b: Point | DragOffset, o?: MouseOptions) =>
			op(() => this.inner.mouse.drag(a, b, o)),
		wheel: (o: WheelOptions) => op(() => this.inner.mouse.wheel(o)),
	};
	process = {
		status: () => this.inner.process.status(),
		signal: (s: string, t?: 'child' | 'process-group') => op(() => this.inner.process.signal(s, t)),
		waitForExit: (o?: AssertionOptions) => op(() => this.inner.process.waitForExit(o)),
	};
	get screen(): OperationTerminal['screen'] & OperationQueries {
		const screen = this.inner.screen;
		return Object.freeze({
			...screen,
			findBy: (locator: RegionLocator, options?: WaitForOptions) =>
				op(() => screen.findBy(locator, options)),
			findAllBy: (locator: RegionLocator, options?: WaitForOptions) =>
				op(() => screen.findAllBy(locator, options)),
			findByText: (...args: Parameters<ScreenQueries['findByText']>) =>
				op(() => screen.findByText(...args)),
			findAllByText: (...args: Parameters<ScreenQueries['findAllByText']>) =>
				op(() => screen.findAllByText(...args)),
			findBySelector: (...args: Parameters<ScreenQueries['findBySelector']>) =>
				op(() => screen.findBySelector(...args)),
			findAllBySelector: (...args: Parameters<ScreenQueries['findAllBySelector']>) =>
				op(() => screen.findAllBySelector(...args)),
		});
	}
	revisions = {
		collect: (options: RevisionCollectionOptions) =>
			op(() => this.inner.revisions.collect(options)),
	};
	history = {
		read: (query?: HistoryQuery) => op(() => this.inner.history.read(query)),
		findText: (text: string, options?: HistorySearchOptions) =>
			op(() => this.inner.history.findText(text, options)),
	};
	graphics = {
		inspectImage: (id: number) => op(() => this.inner.graphics.inspectImage(id)),
		copyImageData: (id: number) => op(() => this.inner.graphics.copyImageData(id)),
	};
	getByText(t: string, o?: TextLocatorOptions): EffectionLocator {
		return new EffectionLocator(this.inner.getByText(t, o));
	}
	region(r: Rect): OperationRegion {
		const x = this.inner.region(r);
		return {
			getByText: (t, o) => new EffectionLocator(x.getByText(t, o) as Locator),
			snapshot: () => x.snapshot(),
		};
	}
	resize(v: Viewport): Operation<ActionReceipt> {
		return op(() => this.inner.resize(v));
	}
	close(): Operation<ActionReceipt> {
		return op(() => this.inner.close());
	}
}
/** Launch a terminal session, run an Effection operation body, and clean up when done. */
export function* withTerminal<T>(
	options: TerminalLaunchOptions,
	body: (terminal: EffectionTerminal) => Operation<T>,
): Operation<T> {
	const session = yield* useSession(options);
	const terminal = yield* execution(session);
	try {
		const result: T = yield* body(new EffectionTerminal(terminal));
		yield* call(() => recordSuccess(session));
		return result;
	} catch (error) {
		yield* call(() => recordFailure(session, error));
		throw error;
	}
}
/** Effection locator assertion expectation. */
export interface EffectionLocatorExpectation {
	toBePresent(options?: AssertionOptions): Operation<LocatorMatch>;
	toBeAbsent(options?: StableAssertionOptions): Operation<void>;
	toBeStable(options?: StableAssertionOptions): Operation<LocatorMatch>;
	toHaveStyle(style: StyleQuery, options?: AssertionOptions): Operation<LocatorMatch>;
	toContainCursor(options?: AssertionOptions): Operation<LocatorMatch>;
}
/** Effection terminal assertion expectation. */
export interface EffectionTerminalExpectation {
	toSatisfy(
		predicate: (snapshot: ScreenSnapshot) => boolean,
		options?: StableAssertionOptions,
	): Operation<ScreenSnapshot>;
	toHaveShown(
		predicate: (snapshot: ScreenSnapshot) => boolean,
		options?: TransientAssertionOptions,
	): Operation<ScreenRevision>;
	toHaveShownText(text: string, options?: TransientAssertionOptions): Operation<ScreenRevision>;
}
/** Create an Effection operation expectation for a locator or terminal. */
export function expectOperation(
	target: EffectionLocator | EffectionTerminal,
): EffectionLocatorExpectation | EffectionTerminalExpectation {
	if (target instanceof EffectionLocator) {
		const e = expectAsync(target.inner);
		return {
			toBePresent: (o?: AssertionOptions) => op(() => e.toBePresent(o)),
			toBeAbsent: (o?: StableAssertionOptions) => op(() => e.toBeAbsent(o)),
			toBeStable: (o?: StableAssertionOptions) => op(() => e.toBeStable(o)),
			toHaveStyle: (style: StyleQuery, o?: AssertionOptions) => op(() => e.toHaveStyle(style, o)),
			toContainCursor: (o?: AssertionOptions) => op(() => e.toContainCursor(o)),
		};
	}
	const e = expectAsync(target.inner.session);
	return {
		toSatisfy: (predicate: (snapshot: ScreenSnapshot) => boolean, o?: StableAssertionOptions) =>
			op(() => e.toSatisfy(predicate, o)),
		toHaveShown: (
			predicate: (snapshot: ScreenSnapshot) => boolean,
			o?: TransientAssertionOptions,
		) => op(() => e.toHaveShown(predicate, o)),
		toHaveShownText: (t: string, o?: TransientAssertionOptions) =>
			op(() => e.toHaveShownText(t, o)),
	};
}

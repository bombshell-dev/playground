import type { TerminalProgram } from '../operations.ts';
import { call, scoped, useAbortSignal, type Operation } from 'effection';
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
/** Effection wrapper around an async Locator. */
export class EffectionLocator implements OperationLocator {
	constructor(
		readonly inner: Locator,
		readonly owner?: AsyncExecution,
	) {}
	/** Legacy locator work is cancelled with both its caller and owning terminal. */
	invoke<T>(body: (locator: Locator) => Promise<T>): Operation<T> {
		const locator = this.inner;
		const operation = function* (): Operation<T> {
			const signal = yield* useAbortSignal();
			return yield* call(() => body(locator.withSignal(signal)));
		};
		return this.owner ? this.owner.runOperation(operation) : scoped(operation);
	}
	nth(i: number): EffectionLocator {
		return new EffectionLocator(this.inner.nth(i), this.owner);
	}
	region(r: Rect): EffectionLocator {
		return new EffectionLocator(this.inner.region(r), this.owner);
	}
	matches(): readonly LocatorMatch[] {
		return this.inner.matches();
	}
	click(o?: MouseOptions): Operation<ActionReceipt> {
		return this.invoke((locator) => locator.click(o));
	}
}
/** Effection wrapper around a TerminalSession. */
export class EffectionTerminal implements OperationTerminal {
	constructor(readonly inner: AsyncExecution) {}
	/** Bridge Promise APIs through a child of the invoking scope, not the session owner. */
	invoke<T>(body: (terminal: AsyncExecution) => Promise<T>): Operation<T> {
		const owner = this.inner;
		return owner.runOperation(function* () {
			const invocation = yield* execution(owner.session, owner.keyboardMiddleware);
			return yield* call(() => body(invocation));
		});
	}
	get signal(): AbortSignal {
		return this.inner.signal;
	}
	assert(locator: RegionLocator, matcher: Matcher): ReturnType<typeof assertRegion> {
		return this.inner.runOperation(() => assertRegion(this.inner.session, locator, matcher));
	}
	expect(locator: RegionLocator): ReturnType<typeof expectRegion.operation> {
		return expectRegion.operation(this, locator);
	}
	waitFor = <T>(callback: () => T | PromiseLike<T>, options?: WaitForOptions): Operation<T> =>
		this.invoke((inner) => inner.waitFor(callback, options));
	capture(
		options: CaptureOptions,
		body: (terminal: EffectionTerminal) => Operation<unknown>,
	): ReturnType<typeof captureOperation> {
		return this.inner.runOperation(() =>
			captureOperation(
				this.inner.session,
				options,
				(terminal) => body(new EffectionTerminal(terminal)),
				this.inner.keyboardMiddleware,
			),
		);
	}
	/** Invoke a program directly in the caller scope through owned capabilities. */
	run<T>(program: TerminalProgram<T>): Operation<T> {
		return this.inner.runOperation(program);
	}
	keyboard = {
		press: (k: KeyName | KeyPress) => this.inner.operations.keyboard.press(k),
		type: (t: string, o?: TraceableInputOptions) => this.inner.operations.keyboard.type(t, o),
		paste: (t: string, o?: TraceableInputOptions) => this.inner.operations.keyboard.paste(t, o),
		focus: (s: 'in' | 'out') => this.inner.operations.keyboard.focus(s),
		write: (d: Uint8Array) => this.inner.operations.keyboard.write(d),
	};
	mouse = {
		move: (p: MouseTarget, o?: MouseOptions) => this.invoke((inner) => inner.mouse.move(p, o)),
		hover: (p: MouseTarget, o?: MouseOptions) => this.invoke((inner) => inner.mouse.hover(p, o)),
		down: (p: MouseTarget, o?: MouseOptions) => this.invoke((inner) => inner.mouse.down(p, o)),
		up: (p: MouseTarget, o?: MouseOptions) => this.invoke((inner) => inner.mouse.up(p, o)),
		click: (p: MouseTarget, o?: MouseOptions) => this.invoke((inner) => inner.mouse.click(p, o)),
		doubleClick: (p: MouseTarget, o?: MouseOptions) =>
			this.invoke((inner) => inner.mouse.doubleClick(p, o)),
		// oxlint-disable-next-line bombshell-dev/max-params -- wraps mouse.drag(start, end, options) API
		drag: (a: MouseTarget, b: Point | DragOffset, o?: MouseOptions) =>
			this.invoke((inner) => inner.mouse.drag(a, b, o)),
		wheel: (o: WheelOptions) => this.invoke((inner) => inner.mouse.wheel(o)),
	};
	process = {
		status: () => this.inner.process.status(),
		signal: (s: string, t?: 'child' | 'process-group') =>
			this.invoke((inner) => inner.process.signal(s, t)),
		waitForExit: (o?: AssertionOptions) => this.invoke((inner) => inner.process.waitForExit(o)),
	};
	get screen(): OperationTerminal['screen'] & OperationQueries {
		const screen = this.inner.screen;
		return Object.freeze({
			...screen,
			findBy: (locator: RegionLocator, options?: WaitForOptions) =>
				this.invoke((inner) => inner.screen.findBy(locator, options)),
			findAllBy: (locator: RegionLocator, options?: WaitForOptions) =>
				this.invoke((inner) => inner.screen.findAllBy(locator, options)),
			findByText: (...args: Parameters<ScreenQueries['findByText']>) =>
				this.invoke((inner) => inner.screen.findByText(...args)),
			findAllByText: (...args: Parameters<ScreenQueries['findAllByText']>) =>
				this.invoke((inner) => inner.screen.findAllByText(...args)),
			findBySelector: (...args: Parameters<ScreenQueries['findBySelector']>) =>
				this.invoke((inner) => inner.screen.findBySelector(...args)),
			findAllBySelector: (...args: Parameters<ScreenQueries['findAllBySelector']>) =>
				this.invoke((inner) => inner.screen.findAllBySelector(...args)),
		});
	}
	revisions = {
		collect: (options: RevisionCollectionOptions) =>
			this.invoke((inner) => inner.revisions.collect(options)),
	};
	history = {
		read: (query?: HistoryQuery) => this.invoke((inner) => inner.history.read(query)),
		findText: (text: string, options?: HistorySearchOptions) =>
			this.invoke((inner) => inner.history.findText(text, options)),
	};
	graphics = {
		inspectImage: (id: number) => this.invoke((inner) => inner.graphics.inspectImage(id)),
		copyImageData: (id: number) => this.invoke((inner) => inner.graphics.copyImageData(id)),
	};
	getByText(t: string, o?: TextLocatorOptions): EffectionLocator {
		return new EffectionLocator(this.inner.getByText(t, o), this.inner);
	}
	region(r: Rect): OperationRegion {
		const x = this.inner.region(r);
		return {
			getByText: (t, o) => new EffectionLocator(x.getByText(t, o) as Locator, this.inner),
			snapshot: () => x.snapshot(),
		};
	}
	resize(v: Viewport): Operation<ActionReceipt> {
		return this.invoke((inner) => inner.resize(v));
	}
	close(): Operation<ActionReceipt> {
		return this.invoke((inner) => inner.close());
	}
}
/** Launch a terminal session, run an Effection operation body, and clean up when done. */
export function* withTerminal<T>(
	options: TerminalLaunchOptions,
	body: (terminal: EffectionTerminal) => Operation<T>,
): Operation<T> {
	return yield* scoped(function* () {
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
	});
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
		return {
			toBePresent: (o?: AssertionOptions) =>
				target.invoke((inner) => expectAsync(inner).toBePresent(o)),
			toBeAbsent: (o?: StableAssertionOptions) =>
				target.invoke((inner) => expectAsync(inner).toBeAbsent(o)),
			toBeStable: (o?: StableAssertionOptions) =>
				target.invoke((inner) => expectAsync(inner).toBeStable(o)),
			toHaveStyle: (style: StyleQuery, o?: AssertionOptions) =>
				target.invoke((inner) => expectAsync(inner).toHaveStyle(style, o)),
			toContainCursor: (o?: AssertionOptions) =>
				target.invoke((inner) => expectAsync(inner).toContainCursor(o)),
		};
	}

	return {
		toSatisfy: (predicate: (snapshot: ScreenSnapshot) => boolean, o?: StableAssertionOptions) =>
			target.invoke((inner) => expectAsync(inner.session, inner.signal).toSatisfy(predicate, o)),
		toHaveShown: (
			predicate: (snapshot: ScreenSnapshot) => boolean,
			o?: TransientAssertionOptions,
		) =>
			target.invoke((inner) => expectAsync(inner.session, inner.signal).toHaveShown(predicate, o)),
		toHaveShownText: (t: string, o?: TransientAssertionOptions) =>
			target.invoke((inner) => expectAsync(inner.session, inner.signal).toHaveShownText(t, o)),
	};
}

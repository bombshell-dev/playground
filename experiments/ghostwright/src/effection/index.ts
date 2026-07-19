import { call, type Operation } from 'effection';
import type {
	AssertionOptions,
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
	TerminalLaunchOptions,
	TextLocatorOptions,
	TraceableInputOptions,
	TransientAssertionOptions,
	Viewport,
	WheelOptions,
} from '../types.ts';
import { expectTerminal as expectAsync } from '../assertions/index.ts';
import type { Locator } from '../terminal/session.ts';
import { TerminalSession } from '../terminal/session.ts';
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
	click(o?: MouseOptions): Operation<Locator> {
		return op(() => this.inner.click(o));
	}
}
/** Effection wrapper around a TerminalSession. */
export class EffectionTerminal implements OperationTerminal {
	constructor(readonly inner: TerminalSession) {}
	keyboard = {
		press: (k: KeyName | KeyPress) => op(() => this.inner.keyboard.press(k)),
		type: (t: string, o?: TraceableInputOptions) => op(() => this.inner.keyboard.type(t, o)),
		paste: (t: string, o?: TraceableInputOptions) => op(() => this.inner.keyboard.paste(t, o)),
		focus: (s: 'in' | 'out') => op(() => this.inner.keyboard.focus(s)),
		write: (d: Uint8Array) => op(() => this.inner.keyboard.write(d)),
	};
	mouse = {
		move: (p: Point, o?: MouseOptions) => op(() => this.inner.mouse.move(p, o)),
		down: (p: Point, o?: MouseOptions) => op(() => this.inner.mouse.down(p, o)),
		up: (p: Point, o?: MouseOptions) => op(() => this.inner.mouse.up(p, o)),
		click: (p: Point, o?: MouseOptions) => op(() => this.inner.mouse.click(p, o)),
		doubleClick: (p: Point, o?: MouseOptions) => op(() => this.inner.mouse.doubleClick(p, o)),
		// oxlint-disable-next-line max-params -- wraps mouse.drag(start, end, options) API
		drag: (a: Point, b: Point, o?: MouseOptions) => op(() => this.inner.mouse.drag(a, b, o)),
		wheel: (o: WheelOptions) => op(() => this.inner.mouse.wheel(o)),
	};
	process = {
		status: () => this.inner.process.status(),
		signal: (s: string, t?: 'child' | 'process-group') => op(() => this.inner.process.signal(s, t)),
		waitForExit: (o?: AssertionOptions) => op(() => this.inner.process.waitForExit(o)),
	};
	get screen() {
		return this.inner.screen;
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
		return new EffectionLocator(this.inner.getByText(t, o) as Locator);
	}
	region(r: Rect): OperationRegion {
		const x = this.inner.region(r);
		return {
			getByText: (t, o) => new EffectionLocator(x.getByText(t, o) as Locator),
			snapshot: () => x.snapshot(),
		};
	}
	resize(v: Viewport): Operation<void> {
		return op(() => this.inner.resize(v));
	}
	close(): Operation<void> {
		return op(() => this.inner.close());
	}
}
/** Launch a terminal session, run an Effection operation body, and clean up when done. */
export function* withTerminal<T>(
	options: TerminalLaunchOptions,
	body: (terminal: OperationTerminal) => Operation<T>,
): Operation<T> {
	const session: TerminalSession = yield* call(() => TerminalSession.launch(options));
	try {
		const result: T = yield* body(new EffectionTerminal(session));
		if (session.trace.policy === 'on')
			yield* call(() =>
				session.trace.persist(
					'Session completed successfully',
					session.screen.current(),
					session.process.status(),
				),
			);
		return result;
	} catch (error) {
		try {
			const path = yield* call(() =>
				session.trace.persist(error, session.screen.current(), session.process.status()),
			);
			if (path && error instanceof Error) {
				(error as Error & { tracePath?: string }).tracePath = path;
				error.message += `\ntrace artifact: ${path}`;
			}
		} catch (traceError) {
			if (error instanceof Error)
				(error as Error & { suppressed?: unknown[] }).suppressed = [traceError];
		}
		throw error;
	} finally {
		yield* call(() => session.close());
	}
}
/** Effection locator assertion expectation. */
export interface EffectionLocatorExpectation {
	toBePresent(options?: AssertionOptions): Operation<LocatorMatch>;
	toBeAbsent(options?: StableAssertionOptions): Operation<void>;
	toBeStable(options?: StableAssertionOptions): Operation<LocatorMatch>;
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
		};
	}
	const e = expectAsync(target.inner);
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

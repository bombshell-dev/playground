import { call, type Operation } from 'effection';
import type {
	ActionReceipt,
	AssertionOptions,
	KeyName,
	HistoryQuery,
	HistorySearchOptions,
	KeyPress,
	MouseOptions,
	RevisionCollectionOptions,
	OperationLocator,
	OperationRegion,
	OperationTerminal,
	Point,
	Rect,
	StableAssertionOptions,
	ScreenSnapshot,
	TerminalLaunchOptions,
	TextLocatorOptions,
	TraceableInputOptions,
	TransientAssertionOptions,
	WheelOptions,
} from '../types.ts';
import { expectTerminal as expectAsync } from '../assertions/index.ts';
import { Locator, TerminalSession } from '../terminal/session.ts';
const op = <T>(fn: () => Promise<T>): Operation<T> => call(fn);
export class EffectionLocator implements OperationLocator {
	constructor(readonly inner: Locator) {}
	nth(i: number) {
		return new EffectionLocator(this.inner.nth(i));
	}
	region(r: Rect) {
		return new EffectionLocator(this.inner.region(r));
	}
	matches() {
		return this.inner.matches();
	}
	click(o?: MouseOptions) {
		return op(() => this.inner.click(o));
	}
}
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
	getByText(t: string, o?: TextLocatorOptions) {
		return new EffectionLocator(this.inner.getByText(t, o) as Locator);
	}
	region(r: Rect): OperationRegion {
		const x = this.inner.region(r);
		return {
			getByText: (t, o) => new EffectionLocator(x.getByText(t, o) as Locator),
			snapshot: () => x.snapshot(),
		};
	}
	resize(v: any) {
		return op(() => this.inner.resize(v));
	}
	close() {
		return op(() => this.inner.close());
	}
}
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
export function expectOperation(target: EffectionLocator | EffectionTerminal) {
	if (target instanceof EffectionLocator) {
		const e = expectAsync(target.inner) as any;
		return {
			toBePresent: (o?: AssertionOptions) => op(() => e.toBePresent(o)),
			toBeAbsent: (o?: StableAssertionOptions) => op(() => e.toBeAbsent(o)),
			toBeStable: (o?: StableAssertionOptions) => op(() => e.toBeStable(o)),
		};
	}
	const e = expectAsync(target.inner) as any;
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

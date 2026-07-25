import { StrictLocatorError, TerminalAssertionError } from '../errors.ts';
import type { AsyncLocatorExpectation, AsyncTerminalExpectation } from './types-internal.ts';
import type {
	AssertionOptions,
	ScreenRevision,
	ScreenSnapshot,
	StableAssertionOptions,
	StyleQuery,
	TransientAssertionOptions,
} from '../types.ts';
import { DEFAULT_ASSERTION_TIMEOUT_MS } from '../types.ts';
import { cellsMatchStyle, describeColor } from '../styles.ts';
import { Locator } from '../terminal/session.ts';
import type { TerminalSession } from '../terminal/session.ts';

/**
 * Wrap a user predicate so it can be evaluated against any screen revision.
 *
 * Predicates run against every revision, including the blank frames before the
 * application has painted anything. A predicate that reads a not yet rendered
 * layout would otherwise throw and abort the whole assertion, surfacing as an
 * unrelated failure. Throwing is treated as "not satisfied", and the most
 * recent error is reported in the diagnostic if the assertion never converges.
 */
function safePredicate(predicate: (snapshot: ScreenSnapshot) => boolean): {
	test: (snapshot: ScreenSnapshot) => boolean;
	note: () => string;
} {
	let lastError: unknown;
	return {
		test: (snapshot) => {
			try {
				return predicate(snapshot);
			} catch (error) {
				lastError = error;
				return false;
			}
		},
		note: () =>
			lastError === undefined
				? ''
				: `\npredicate threw (treated as unsatisfied): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
	};
}
// oxlint-disable-next-line max-params -- diagnostic needs all four params for failure reporting
function diagnostic(
	session: TerminalSession,
	expected: string,
	timeout: number,
	settle?: number,
): string {
	const s = session.screen.current(),
		tens = Array.from({ length: s.viewport.columns }, (_, column) =>
			column % 10 === 0 ? String(Math.floor(column / 10) % 10) : ' ',
		).join(''),
		ones = Array.from({ length: s.viewport.columns }, (_, column) => String(column % 10)).join(''),
		rows = s.lines.map((line) => `${String(line.row).padStart(3)} |${line.text}|`).join('\n'),
		recent = session.trace
			.events()
			.filter((event) => event.type === 'action')
			.slice(-5)
			.map((event) => `#${event.sequence} action=${event.actionSequence} kind=${event.kind}`)
			.join('; ');
	return `Ghostwright assertion failed\nexpected: ${expected}\ntimeout: ${timeout} ms${settle === undefined ? '' : `\nsettle: ${settle} ms`}\nviewport: ${s.viewport.columns}x${s.viewport.rows}\ncursor: (${s.cursor.column},${s.cursor.row}) visible=${s.cursor.visible} shape=${s.cursor.shape} blinking=${s.cursor.blinking}\nactive buffer: ${s.activeBuffer}\nmodes: ${JSON.stringify(s.modes)}\nprocess: ${JSON.stringify(session.process.status())}\nchanged rows: ${session.revisionHistory.at(-1)?.changedRows.join(',') ?? 'none'}\nhistory: earliest=${session.revisionHistory.at(0)?.sequence ?? s.sequence} latest=${session.revisionHistory.at(-1)?.sequence ?? s.sequence}\nrecent actions: ${recent || 'none'}\nclosest candidates: ${
		s.lines
			.map((line) => line.text.trimEnd())
			.filter(Boolean)
			.slice(0, 5)
			.map((line) => JSON.stringify(line))
			.join(', ') || 'none'
	}\n\n    ${tens}\n    ${ones}\n${rows}`;
}
// oxlint-disable-next-line max-params -- wait needs all four params for polling logic
async function wait(
	session: TerminalSession,
	test: () => boolean,
	timeout: number,
	message: () => string,
): Promise<void> {
	try {
		await session.waitForChange(test, timeout);
	} catch (cause) {
		if (cause instanceof StrictLocatorError) throw cause;
		throw new TerminalAssertionError(message(), { cause });
	}
}
class LocatorExpectation implements AsyncLocatorExpectation {
	constructor(readonly locator: Locator) {}
	async toBePresent(options: AssertionOptions = {}): Promise<Locator> {
		const timeout =
			options.timeoutMs ??
			this.locator.session.options.assertionTimeoutMs ??
			DEFAULT_ASSERTION_TIMEOUT_MS;
		try {
			return await this.locator.unique(timeout);
		} catch (cause) {
			if (cause instanceof StrictLocatorError) throw cause;
			throw new TerminalAssertionError(
				diagnostic(
					this.locator.session,
					`${JSON.stringify(this.locator.query)} to be present`,
					timeout,
				),
				{ cause },
			);
		}
	}
	async toBeStable(options: StableAssertionOptions = {}): Promise<Locator> {
		const timeout =
				options.timeoutMs ??
				this.locator.session.options.assertionTimeoutMs ??
				DEFAULT_ASSERTION_TIMEOUT_MS,
			settle = options.settleMs ?? this.locator.session.options.settleMs ?? 100,
			start = performance.now();
		let match = await this.toBePresent({ timeoutMs: timeout });
		for (;;) {
			const age =
					this.locator.session.now() - this.locator.session.screen.current().lastVisualChangeAt,
				remaining = Math.max(0, settle - age);
			if (!remaining) return match;
			if (performance.now() - start + remaining > timeout)
				throw new TerminalAssertionError(
					diagnostic(
						this.locator.session,
						`${JSON.stringify(this.locator.query)} to be visually stable`,
						timeout,
						settle,
					),
				);
			await new Promise<void>((resolve) => {
				const off = this.locator.session.subscribe(() => {
						off();
						clearTimeout(timer);
						resolve();
					}),
					timer = setTimeout(() => {
						off();
						resolve();
					}, remaining);
			});
			const m = this.locator.matches();
			if (m.length > 1)
				throw new StrictLocatorError(
					`Locator ${JSON.stringify(this.locator.query)} matched ${m.length} ranges`,
				);
			if (m.length === 1) match = m[0];
			else
				match = await this.toBePresent({
					timeoutMs: Math.max(1, timeout - (performance.now() - start)),
				});
		}
	}
	async toBeAbsent(options: StableAssertionOptions = {}): Promise<void> {
		const timeout =
				options.timeoutMs ??
				this.locator.session.options.assertionTimeoutMs ??
				DEFAULT_ASSERTION_TIMEOUT_MS,
			settle = options.settleMs ?? this.locator.session.options.settleMs ?? 100,
			start = performance.now();
		for (;;) {
			if (this.locator.matches().length === 0) {
				const snapshot = this.locator.session.screen.current(),
					age = this.locator.session.now() - snapshot.lastVisualChangeAt,
					remaining = Math.max(0, settle - age);
				if (remaining === 0) return;
				await new Promise<void>((resolve) => {
					const off = this.locator.session.subscribe(() => {
							off();
							clearTimeout(timer);
							resolve();
						}),
						timer = setTimeout(() => {
							off();
							resolve();
						}, remaining);
				});
				if (
					this.locator.matches().length === 0 &&
					this.locator.session.now() - this.locator.session.screen.current().lastVisualChangeAt >=
						settle
				)
					return;
			}
			if (performance.now() - start >= timeout)
				throw new TerminalAssertionError(
					diagnostic(
						this.locator.session,
						`${JSON.stringify(this.locator.query)} to be absent`,
						timeout,
						settle,
					),
				);
			await wait(
				this.locator.session,
				() => this.locator.matches().length === 0,
				Math.max(1, timeout - (performance.now() - start)),
				() =>
					diagnostic(
						this.locator.session,
						`${JSON.stringify(this.locator.query)} to be absent`,
						timeout,
						settle,
					),
			);
		}
	}
	async toHaveStyle(style: StyleQuery, options: AssertionOptions = {}): Promise<Locator> {
		const timeout =
				options.timeoutMs ??
				this.locator.session.options.assertionTimeoutMs ??
				DEFAULT_ASSERTION_TIMEOUT_MS,
			start = performance.now(),
			satisfied = () => {
				const m = this.locator.matches();
				return m.length === 1 && cellsMatchStyle(m[0].cells, style);
			};
		await this.toBePresent({ timeoutMs: timeout });
		if (!satisfied())
			await wait(
				this.locator.session,
				satisfied,
				Math.max(1, timeout - (performance.now() - start)),
				() => {
					const m = this.locator.matches(),
						actual = m[0]?.cells.find((cell) => !cell.continuation)?.style;
					return `${diagnostic(
						this.locator.session,
						`${JSON.stringify(this.locator.query)} to have style ${JSON.stringify(style)}`,
						timeout,
					)}\nactual style: ${
						actual
							? `foreground=${describeColor(actual.foreground)} background=${describeColor(actual.background)} bold=${actual.bold} inverse=${actual.inverse} underline=${actual.underline}`
							: 'no match'
					}`;
				},
			);
		return this.locator.matches()[0];
	}
	async toContainCursor(options: AssertionOptions = {}): Promise<Locator> {
		const timeout =
				options.timeoutMs ??
				this.locator.session.options.assertionTimeoutMs ??
				DEFAULT_ASSERTION_TIMEOUT_MS,
			start = performance.now(),
			satisfied = () => {
				const m = this.locator.matches();
				if (m.length !== 1) return false;
				const { range } = m[0],
					{ cursor } = this.locator.session.screen.current();
				return (
					cursor.row >= range.row &&
					cursor.row < range.row + range.height &&
					cursor.column >= range.column &&
					cursor.column < range.column + range.width
				);
			};
		await this.toBePresent({ timeoutMs: timeout });
		if (!satisfied())
			await wait(
				this.locator.session,
				satisfied,
				Math.max(1, timeout - (performance.now() - start)),
				() =>
					diagnostic(
						this.locator.session,
						`${JSON.stringify(this.locator.query)} to contain the cursor`,
						timeout,
					),
			);
		return this.locator.matches()[0];
	}
}
class TerminalExpectation implements AsyncTerminalExpectation {
	constructor(readonly session: TerminalSession) {}
	async toSatisfy(
		predicate: (snapshot: ScreenSnapshot) => boolean,
		options: StableAssertionOptions = {},
	): Promise<ScreenSnapshot> {
		const timeout =
				options.timeoutMs ??
				this.session.options.assertionTimeoutMs ??
				DEFAULT_ASSERTION_TIMEOUT_MS,
			settle = options.settleMs ?? this.session.options.settleMs ?? 100,
			started = performance.now(),
			safe = safePredicate(predicate);
		for (;;) {
			const snapshot = this.session.screen.current();
			if (safe.test(snapshot)) {
				const remaining = Math.max(0, settle - (this.session.now() - snapshot.lastVisualChangeAt));
				if (remaining === 0) return snapshot;
				if (performance.now() - started + remaining > timeout)
					throw new TerminalAssertionError(
						diagnostic(this.session, 'screen predicate to converge', timeout, settle) + safe.note(),
					);
				await new Promise<void>((resolve) => {
					const unsubscribe = this.session.subscribe(() => {
							clearTimeout(timer);
							unsubscribe();
							resolve();
						}),
						timer = setTimeout(() => {
							unsubscribe();
							resolve();
						}, remaining);
				});
				continue;
			}
			await wait(
				this.session,
				() => safe.test(this.session.screen.current()),
				Math.max(1, timeout - (performance.now() - started)),
				() =>
					diagnostic(this.session, 'screen predicate to converge', timeout, settle) + safe.note(),
			);
		}
	}
	async toHaveShown(
		predicate: (snapshot: ScreenSnapshot) => boolean,
		options: TransientAssertionOptions = {},
	): Promise<ScreenRevision> {
		const timeout =
				options.timeoutMs ??
				this.session.options.assertionTimeoutMs ??
				DEFAULT_ASSERTION_TIMEOUT_MS,
			baseline =
				typeof options.since === 'number'
					? options.since
					: (options.since?.screenSequenceBefore ??
						this.session.lastAction?.screenSequenceBefore ??
						this.session.screen.current().sequence);
		const safe = safePredicate(predicate),
			find = () =>
				this.session.revisionsSince(baseline).find((revision) => safe.test(revision.snapshot));
		let result = find();
		if (!result)
			await wait(
				this.session,
				() => !!(result = find()),
				timeout,
				() =>
					diagnostic(this.session, `screen predicate since revision ${baseline}`, timeout) +
					safe.note(),
			);
		return result as ScreenRevision;
	}
	toHaveShownText(text: string, options: TransientAssertionOptions = {}): Promise<ScreenRevision> {
		return this.toHaveShown(
			(snapshot) => snapshot.lines.some((line) => line.text.includes(text)),
			options,
		);
	}
}
/** Create an async assertion expectation for a locator or terminal session. */
export function expectTerminal(
	target: Locator | TerminalSession,
): LocatorExpectation | TerminalExpectation {
	return target instanceof Locator
		? new LocatorExpectation(target)
		: new TerminalExpectation(target);
}

// CSS + @media queries driven by terminal capabilities, rendered live.
//
// Detects the terminal (terminfo, plus a bounded probe round-trip when
// stdin is a TTY), keeps the capability maps in a `@bomb.sh/tty` term —
// `scan()` events flow through `term.update()`, which folds them into
// `term.capabilities` — snapshots a `@bomb.sh/dom` document, computes
// styles with `@bomb.sh/css`, and renders the computed styles as real
// frames: resize the terminal and the `@media` queries re-evaluate, the
// board relayouts, the accent color changes, and the status bar prints
// the numbers.
//
// `@bomb.sh/dom` has no run loop by design (frame scheduling belongs to
// consumers), so the demo owns a minimal one: probe window, then
// repaint-on-resize (the render itself diffs inside `Term.render`, so
// only changed cells hit the wire). Real applications get the loop from
// the platform (`@clack/ui`'s `createUI().main()`).
//
// Usage: pnpm --filter @examples/css-tty demo
import { compile, type ComputedProperty, type CssNode } from '@bomb.sh/css';
import {
	alternateBuffer,
	createInput,
	createTerm,
	cursor,
	detectTerminal,
	settings,
	type RuntimeCapabilities,
	type Setting,
	type TerminalInfo,
} from '@bomb.sh/tty';
import { capabilityVariables, environmentFromCapabilities, type TerminalSize } from './index.ts';
import { createDemoDocument, snapshotDocument, type DocumentSnapshot } from './tree.ts';
import { renderTree } from './render.ts';
import { DEMO_CSS } from './styles.ts';

/// How long to wait for probe responses before proceeding with whatever
/// arrived. Terminals that never answer keep the static capabilities.
const PROBE_TIMEOUT_MS = 250;

function currentSize(): TerminalSize {
	// `||` rather than `??`: a degenerate pty reports 0×0, and a zero-sized
	// term lays out nothing.
	return {
		columns: process.stdout.columns || 80,
		rows: process.stdout.rows || 24,
	};
}

/// Write the terminfo probe and feed responses through the input parser
/// into `term.update()` until the theme answers (or the timeout lapses),
/// inside a short raw-mode window so responses reach the parser
/// byte-for-byte.
async function probeCapabilities(
	terminfo: TerminalInfo,
	term: Awaited<ReturnType<typeof createTerm>>,
): Promise<void> {
	const input = await createInput({ terminfo });
	const stream = process.stdin;
	const wasRaw = stream.isRaw ?? false;

	stream.setRawMode(true);
	try {
		await new Promise<void>((resolve) => {
			let done = false;
			const finish = () => {
				if (done) {
					return;
				}
				done = true;
				clearTimeout(timer);
				stream.off('data', onData);
				// A response ending mid-burst can leave a buffered lone ESC;
				// one argument-less scan flushes it.
				term.update(input.scan().events);
				resolve();
			};
			const onData = (chunk: Buffer | string): void => {
				const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
				const { events } = input.scan(new Uint8Array(bytes));
				// The full events array passes straight through: capability
				// events fold into term.capabilities, everything else is a
				// no-op. Bytes come back only when something must be written
				// now.
				const out = term.update(events);
				if (out.length > 0) {
					process.stdout.write(out);
				}
				if (term.capabilities.theme.background !== undefined) {
					finish();
				}
			};
			const timer = setTimeout(finish, PROBE_TIMEOUT_MS);
			stream.resume();
			stream.on('data', onData);
			process.stdout.write(terminfo.probe);
		});
	} finally {
		// Restore the terminal even if the probe window fails midway.
		stream.setRawMode(wasRaw);
		stream.pause();
	}
}

interface Frame extends DocumentSnapshot {
	env: ReturnType<typeof environmentFromCapabilities>;
	computed: ComputedProperty[][];
	numbers: string;
}

/// Snapshot the demo document and compute every node's style against the
/// environment built from the capability map. The status bar prints the
/// numbers, and the numbers themselves are computed values — so the frame
/// is computed twice: once to read what the CSS decided (axis, gap,
/// breakpoint), once with those numbers written into the tree.
function evaluate(sheet: ReturnType<typeof compile>, capabilities: RuntimeCapabilities): Frame {
	const size = currentSize();
	const env = environmentFromCapabilities(capabilities, { size });

	const draft = snapshotDocument(createDemoDocument(), {
		rootStyle: capabilityVariables(capabilities),
		viewport: size,
	});
	const draftComputed = sheet.computeTree(draft.nodes, { parents: draft.parents, env });
	const root = Object.fromEntries(draftComputed[0] ?? []);
	const numbers =
		`${size.columns}×${size.rows} cells → ${env.viewportWidth}×${env.viewportHeight}px` +
		` · ${env.colorScheme} · ${capabilities.colors} colors${capabilities.trueColor ? ' · truecolor' : ''}` +
		` · ${root['--axis']} board · gap ${root['--gap']} · ${root['--columns']}-column` +
		` · motion ${root['--motion']}`;

	const frame = snapshotDocument(createDemoDocument(numbers), {
		rootStyle: capabilityVariables(capabilities),
		viewport: size,
	});
	return {
		...frame,
		env,
		computed: sheet.computeTree(frame.nodes, { parents: frame.parents, env }),
		numbers,
	};
}

const formatDeclarations = (declarations: ComputedProperty[]): string =>
	declarations.map(([name, value]) => `${name}: ${value}`).join('; ');

const formatNodeLabel = (node: CssNode): string =>
	[node.tag, node.id ? `#${node.id}` : '', (node.classes ?? []).map((c) => `.${c}`).join('')].join(
		'',
	);

function report(frame: Frame): string {
	const { env, nodes, computed } = frame;
	const lines = [
		`env           viewport=${env.viewportWidth}×${env.viewportHeight}px color-scheme=${env.colorScheme}`,
		`              reduced-motion=${env.reducedMotion ? 'reduce' : 'no-preference'} resolution=${env.resolution}`,
		`              ${frame.numbers}`,
		'',
	];
	for (let index = 0; index < nodes.length; index++) {
		lines.push(
			`${String(index).padStart(2, ' ')} ${formatNodeLabel(nodes[index]!)}`,
			`    ${formatDeclarations(computed[index]!)}`,
		);
	}
	return lines.join('\n');
}

const sheet = compile(DEMO_CSS, 2);
for (const diagnostic of sheet.diagnostics) {
	console.warn(`css ${diagnostic.severity === 0 ? 'error' : 'warning'}: ${diagnostic.message}`);
}

const terminfo = await detectTerminal();
const size = currentSize();
const term = await createTerm({ width: size.columns, height: size.rows, terminfo });
if (process.stdin.isTTY) {
	await probeCapabilities(terminfo, term);
}

const visual = Boolean(process.stdin.isTTY);
let setup: Setting | undefined;
if (visual) {
	// Full-screen app mode: alternate buffer, hidden cursor. Reverted on exit.
	setup = settings(alternateBuffer({ clear: true }), cursor(false));
	process.stdout.write(setup.apply);
}

const repaint = () => {
	const frame = evaluate(sheet, term.capabilities);
	if (!visual) {
		return frame;
	}
	const ops = renderTree(frame, frame.computed);
	const { output } = term.render(ops);
	process.stdout.write(output);
	return frame;
};

const firstFrame = repaint();

if (visual) {
	// Live loop: fold the new size into the term (no WASM reinit), then
	// re-evaluate the stylesheet and re-render. Diffing happens inside
	// Term.render, so only changed cells hit the wire.
	process.stdout.on('resize', () => {
		const next = currentSize();
		term.update([{ type: 'resize', width: next.columns, height: next.rows }]);
		repaint();
	});
	// Liveness, belt and suspenders: stdin referenced AND a timer anchor,
	// so the event loop cannot drain no matter how the underlying streams
	// behave. Cooked mode is restored after the probe, so Ctrl-C still
	// delivers SIGINT.
	process.stdin.ref();
	const keepAlive = setInterval(() => {}, 2_147_483_647);
	const exit = () => {
		clearInterval(keepAlive);
		if (setup) {
			process.stdout.write(setup.revert);
		}
		sheet.release();
		process.exit(0);
	};
	process.on('SIGINT', exit);
	process.on('SIGTERM', exit);
} else {
	// Piped or non-interactive: one evaluation of the numbers + computed
	// declarations, then done.
	console.info(`\n${firstFrame.numbers}`);
	console.info(report(firstFrame));
	sheet.release();
	console.info(`\nno TTY on stdin (isTTY=${process.stdin.isTTY}) — one-shot evaluation`);
}

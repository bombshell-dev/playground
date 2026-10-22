// CSS + @media queries driven by terminal capabilities.
//
// Detects the terminal (terminfo, plus a bounded probe round-trip when
// stdin is a TTY), keeps the capability maps in a `@bomb.sh/tty` term —
// `scan()` events flow through `term.update()`, which folds them into
// `term.capabilities` — snapshots a `@bomb.sh/dom` document, and computes
// styles with `@bomb.sh/css`. While the demo stays open, resizing the
// terminal re-evaluates the `@media` queries live; the parsed stylesheet
// is reused across evaluations, exactly like the engine's per-frame story.
//
// `@bomb.sh/dom` has no run loop by design (frame scheduling belongs to
// consumers), so the demo owns a minimal one: probe window, then repaint
// on resize. Real applications get the loop from the platform
// (`@clack/ui`'s `createUI().main()`).
//
// Usage: pnpm --filter @examples/css-tty demo
import { compile, type ComputedProperty, type CssNode } from '@bomb.sh/css';
import {
	createInput,
	createTerm,
	detectTerminal,
	type RuntimeCapabilities,
	type TerminalInfo,
} from '@bomb.sh/tty';
import { capabilityVariables, environmentFromCapabilities, type TerminalSize } from './index.ts';
import { createDemoDocument, snapshotDocument } from './tree.ts';
import { DEMO_CSS } from './styles.ts';

/// How long to wait for probe responses before proceeding with whatever
/// arrived. Terminals that never answer keep the static capabilities.
const PROBE_TIMEOUT_MS = 250;

function currentSize(): TerminalSize {
	return {
		columns: process.stdout.columns ?? 80,
		rows: process.stdout.rows ?? 24,
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

/// Snapshot the demo document and compute every node's style against the
/// environment built from the capability map. The stylesheet is compiled
/// once and reused; each evaluation is one `computeTree` call.
function evaluate(sheet: ReturnType<typeof compile>, capabilities: RuntimeCapabilities) {
	const size = currentSize();
	const document = createDemoDocument();
	const { nodes, parents } = snapshotDocument(document, {
		rootStyle: capabilityVariables(capabilities),
		viewport: size,
	});
	const env = environmentFromCapabilities(capabilities, { size });
	return { env, nodes, computed: sheet.computeTree(nodes, { parents, env }) };
}

const formatDeclarations = (declarations: ComputedProperty[]): string =>
	declarations.map(([name, value]) => `${name}: ${value}`).join('; ');

const formatNodeLabel = (node: CssNode): string =>
	[node.tag, node.id ? `#${node.id}` : '', (node.classes ?? []).map((c) => `.${c}`).join('')].join(
		'',
	);

function report(capabilities: RuntimeCapabilities, evaluated: ReturnType<typeof evaluate>): string {
	const { env, nodes, computed } = evaluated;
	const theme = capabilities.theme;
	const lines: string[] = [
		`capabilities  colors=${capabilities.colors} truecolor=${capabilities.trueColor ? 'yes' : 'no'}`,
		`              theme=${theme.background ? `bg ${rgb(theme.background)}` : 'unprobed'}`,
		`              kitty-keyboard=${capabilities.kittyKeyboard} kitty-graphics=${capabilities.kittyGraphics}`,
		`env           viewport=${env.viewportWidth}×${env.viewportHeight}px color-scheme=${env.colorScheme}`,
		`              reduced-motion=${env.reducedMotion ? 'reduce' : 'no-preference'} resolution=${env.resolution}`,
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

function rgb({ r, g, b }: { r: number; g: number; b: number }): string {
	const hex = (channel: number) => channel.toString(16).padStart(2, '0');
	return `#${hex(r)}${hex(g)}${hex(b)}`;
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

let first = true;
const print = () => {
	const text = report(term.capabilities, evaluate(sheet, term.capabilities));
	// Repaints clear the screen so the @media flip is visible in place.
	process.stdout.write(first ? `\n${text}\n` : `\x1b[H\x1b[2J${text}\n`);
	first = false;
};

print();

if (process.stdin.isTTY) {
	console.info('\nresize the terminal to re-evaluate @media · Ctrl-C exits');
	// Nothing else holds the event loop open after the probe pauses stdin;
	// keep stdin referenced so the demo stays live for resizes. Cooked
	// mode is restored, so Ctrl-C still delivers SIGINT.
	process.stdin.ref();
	process.stdout.on('resize', print);
	const exit = () => {
		sheet.release();
		process.exit(0);
	};
	process.on('SIGINT', exit);
	process.on('SIGTERM', exit);
} else {
	// Piped or non-interactive: one evaluation, then done.
	sheet.release();
	console.info('\nno TTY on stdin — one-shot evaluation');
}

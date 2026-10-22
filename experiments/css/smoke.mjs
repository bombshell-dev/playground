// Smoke test: drive the ergonomic API through the package entry, against
// the embedded artifact.
// Usage: node smoke.mjs

import assert from 'node:assert/strict';
import { component, compile, computeTree, decodeIr, createEngine, NO_PARENT } from './src/index.js';

const css = `
  :root { --brand: oklch(70% .2 40); color: var(--brand) }
  .panel { container-type: inline-size; container-name: panel }
  .card { padding: 4px; color: light-dark(white, black) }
  .card { & > .title { font-weight: bold } }
  @media (min-width: 24em) {
    @container panel (inline-size > 20em) {
      .card { border-color: var(--brand) }
    }
  }
`;

// compile both compiles and prepares: the Sheet carries diagnostics, the IR
// bytes, and the decoded rules.
const sheet = compile(css, 2);
console.log('diagnostics:', sheet.diagnostics.length ? sheet.diagnostics : 'none');
console.log('ir bytes:', sheet.ir.byteLength);

const parsed = decodeIr(sheet);
console.log('ir version:', parsed.version);
for (const rule of parsed.rules) {
	console.log(`  ${rule.selector} spec=0x${rule.specificity.toString(16)} ->`, rule.declarations);
}

const tree = [
	{ tag: 'root', classes: ['root', 'panel'], width: 400, height: 100, state: 0 }, // container
	{ tag: 'card', classes: ['card'] },
	{ tag: 'title', classes: ['title'] },
];
const parents = [NO_PARENT, 0, 1];

// Node 0 as a named container via container-type comes from computed styles;
// this fixture relies on the width. Compute each node with a dark viewport.
const env = {
	viewportWidth: 400,
	viewportHeight: 300,
	colorScheme: 'dark',
	reducedMotion: false,
	resolution: 1,
};
for (const target of [0, 1, 2]) {
	const computed = sheet.compute(tree, { parents, target, env });
	console.log(`node ${target}:`, JSON.stringify(computed));
}

// Frame loop: `compute` runs per animation frame in real hosts, so its
// memory must not grow over time. The component caches the parsed sheet for
// identical IR bytes; a growing trace means the cache is leaking.
function memoryPages() {
	return component.raw.memory.buffer.byteLength;
}
// The tree API must agree with the per-node API — via both the Sheet methods
// and the module-level functions.
const perNode = [];
for (const target of tree.keys()) {
	perNode.push(sheet.compute(tree, { parents, target, env }));
}
const wholeViaSheet = sheet.computeTree(tree, { parents, env });
const whole = computeTree(sheet, { nodes: tree, parents, env });
assert.deepEqual(perNode, wholeViaSheet, 'Sheet.computeTree disagrees with Sheet.compute');
assert.deepEqual(perNode, whole, 'module-level computeTree disagrees with compute');

// Re-compile + release exercises the slot lifecycle before the loop.
const otherSheet = compile('.x { color: blue }', 2);
otherSheet.compute(tree, { parents, target: 2, env });
otherSheet.release();
for (let i = 0; i < 500; i++) {
	sheet.compute(tree, { parents, target: 2, env });
}
assert.strictEqual(memoryPages(), memoryPages(), 'unstable');
const pagesAfterFrames = memoryPages();
for (let i = 0; i < 500; i++) {
	for (const target of tree.keys()) {
		sheet.compute(tree, { parents, target, env });
	}
	sheet.computeTree(tree, { parents, env });
}
const growth = memoryPages() - pagesAfterFrames;
console.log(`frame loop: 5500 computes, memory grew ${growth} bytes`);
assert.ok(growth <= 0, `per-frame leak: ${growth} bytes over 500 frames`);

// Option-returning calls after compute-tree: the shared return area holds a
// pointer from compute-tree's lowering, so the option discriminant's padding
// bytes are no longer zero. Reading the disc as anything wider than one byte
// misreads these results as absent.
const hotSheet = compile('.card { color: #fff }', 2);
hotSheet.compute(tree, { parents, target: 1, env });
hotSheet.release();

// The rest of the poison matrix: re-compiling the ORIGINAL css…
const reSheet = compile(css, 2);
// …and computing on a sheet adopted after compute-tree.
const adoptedSheet = compile('.card { color: #0f0 }', 2);
const afterPoison = adoptedSheet.computeTree(tree, { parents, env });
assert.ok(
	afterPoison.length === tree.length && afterPoison[1].length > 0,
	`compute-tree on a late-prepared sheet returned no styles: ${JSON.stringify(afterPoison)}`,
);
reSheet.release();
adoptedSheet.release();

// Diagnostics surface through the API: an invalid color warns and the rest
// of the rule recovers — the compile still succeeds.
const warned = compile('.card { color: notacolor; padding: 4px }', 2);
assert.ok(
	warned.diagnostics.some(
		(d) => d.severity === 1 && d.code === 'declaration' && d.message.includes('notacolor'),
	),
	`expected a warning diagnostic, got ${JSON.stringify(warned.diagnostics)}`,
);
warned.release();

// light-dark() survives compilation (branches canonicalized) and resolves
// against the environment's color scheme at computed-value time.
const schemeSheet = compile('.card { color: light-dark(white, black) }', 2);
const schemeTree = [{ tag: 'card', classes: ['card'] }];
const schemeParents = [NO_PARENT];
assertColor(
	colorOf(
		schemeSheet.compute(schemeTree, {
			parents: schemeParents,
			target: 0,
			env: { ...env, colorScheme: 'light' },
		}),
	),
	{
		expected: '#fff',
		label: 'light-dark under a light scheme',
	},
);
assertColor(
	colorOf(
		schemeSheet.compute(schemeTree, {
			parents: schemeParents,
			target: 0,
			env: { ...env, colorScheme: 'dark' },
		}),
	),
	{
		expected: '#000',
		label: 'light-dark under a dark scheme',
	},
);
// A malformed call is invalid at computed-value time: the declaration drops.
const malformedScheme = compile('.card { color: blue }', 2);
const malformedNode = { tag: 'card', classes: ['card'], style: 'color: light-dark(#fff)' };
assert.strictEqual(
	colorOf(malformedScheme.compute([malformedNode], { parents: schemeParents, target: 0, env })),
	null,
	'malformed light-dark must drop the declaration',
);
schemeSheet.release();
malformedScheme.release();

// Disposable protocol: release is synchronous, so `using` works via
// Symbol.dispose and `await using` via Symbol.asyncDispose. (The `using`
// syntax itself is exercised in smoke.using.mjs on Node 24+/bun.)
{
	const scoped = compile('.card { color: red }', 2);
	assert.ok(
		scoped.compute(tree, { parents, target: 1, env }).length > 0,
		'scoped sheet returned no styles',
	);
	scoped[Symbol.dispose]();
	assert.strictEqual(scoped.handle, null, 'Symbol.dispose did not drop the handle');
	scoped.release(); // double release is a safe no-op
	await scoped[Symbol.asyncDispose]();
}

sheet.release();

// ---------------------------------------------------------------------------
// Engine: multi-sheet aggregation, lazy recompile, removal, @layer, inline.
// ---------------------------------------------------------------------------

function colorOf(declarations) {
	const hit = declarations.find(([name]) => name === 'color');
	return hit ? hit[1] : null;
}
function assertColor(actual, { expected, label }) {
	assert.strictEqual(actual, expected, `${label}: expected color ${expected}, got ${actual}`);
}

const cardOnly = [{ tag: 'card', classes: ['card'] }];
const cardRoot = [NO_PARENT];

// Later sheets win at equal specificity (document order). Colors come back
// canonicalized (named → shortest hex), so assert canonical values.
const engine = createEngine();
engine.addSheet('.card { color: #0f0 }');
engine.addSheet('.card { color: #f00 }');
assertColor(colorOf(engine.compute(cardOnly, { parents: cardRoot, target: 0, env })), {
	expected: '#f00',
	label: 'sheet order',
});

// Each sheet compiles once; removal reverts to the prior cascade.
const whiteId = engine.addSheet('.card { color: #123456 }');
assertColor(colorOf(engine.compute(cardOnly, { parents: cardRoot, target: 0, env })), {
	expected: '#123456',
	label: 'added sheet',
});
assert.strictEqual(engine.removeSheet(whiteId), true, 'removeSheet failed');
assertColor(colorOf(engine.compute(cardOnly, { parents: cardRoot, target: 0, env })), {
	expected: '#f00',
	label: 'after removeSheet',
});

// @layer across sheets: layers rank by first appearance (later wins), and
// re-referencing an earlier layer must NOT reorder it to the end — that's
// the discriminator the concatenation scheme has to preserve.
const layerEngine = createEngine();
layerEngine.addSheet('@layer b { .card { color: #0f0 } }');
layerEngine.addSheet('@layer a { .card { color: #ff0 } }');
const plainId = layerEngine.addSheet('.card { color: #234567 }');
assertColor(colorOf(layerEngine.compute(cardOnly, { parents: cardRoot, target: 0, env })), {
	expected: '#234567',
	label: 'unlayered wins',
});
layerEngine.removeSheet(plainId);
assertColor(colorOf(layerEngine.compute(cardOnly, { parents: cardRoot, target: 0, env })), {
	expected: '#ff0',
	label: 'later layer wins',
});
layerEngine.addSheet('@layer b { .card { color: #00f } }');
assertColor(colorOf(layerEngine.compute(cardOnly, { parents: cardRoot, target: 0, env })), {
	expected: '#ff0',
	label: '@layer first-appearance survives re-reference',
});

// Inline styles: inline-normal beats sheet-normal, sheet-!important beats
// inline-normal, inline-!important beats everything. Inline values pass
// through un-canonicalized.
const inlineEngine = createEngine();
inlineEngine.addSheet('.card { color: #fff; background: black }');
inlineEngine.addSheet('.card { color: #f00 !important }');
const inlineNode = [{ tag: 'card', classes: ['card'], style: 'color: blue; border: none' }];
const inlineImp = [{ tag: 'card', classes: ['card'], style: 'color: blue !important' }];
assertColor(colorOf(inlineEngine.compute(inlineNode, { parents: cardRoot, target: 0, env })), {
	expected: '#f00',
	label: 'sheet !important beats inline',
});
assertColor(colorOf(inlineEngine.compute(inlineImp, { parents: cardRoot, target: 0, env })), {
	expected: 'blue',
	label: 'inline !important wins',
});
const noShield = createEngine();
noShield.addSheet('.card { color: #fff }');
assertColor(colorOf(noShield.compute(inlineNode, { parents: cardRoot, target: 0, env })), {
	expected: 'blue',
	label: 'inline beats sheet-normal',
});
assert.ok(
	!noShield
		.compute(inlineNode, { parents: cardRoot, target: 0, env })
		.some(([n, v]) => n === 'border' && v !== 'none'),
	'inline border not applied',
);
// An !important in a rule that does NOT match the node must not shield:
// the inline style still wins (impossible under the old JS-side merge).
const wrongShield = createEngine();
wrongShield.addSheet('.other { color: #f00 !important }');
wrongShield.addSheet('.card { color: #fff }');
assertColor(colorOf(wrongShield.compute(inlineNode, { parents: cardRoot, target: 0, env })), {
	expected: 'blue',
	label: 'non-matching !important does not shield',
});
// Inline declarations seed inheritance: the child inherits the parent's
// inline-overridden custom property.
const inheritEngine = createEngine();
inheritEngine.addSheet('.child { color: var(--brand) }');
const inheritTree = [
	{ tag: 'root', style: '--brand: red' },
	{ tag: 'child', classes: ['child'] },
];
assertColor(colorOf(inheritEngine.computeTree(inheritTree, { parents: [NO_PARENT, 0], env })[1]), {
	expected: 'red',
	label: 'inline custom property inherits',
});
noShield.release();
wrongShield.release();
inheritEngine.release();

// Engine dispose releases the sheet; a later compute lazily re-prepares.
inlineEngine[Symbol.dispose]();
assertColor(colorOf(inlineEngine.compute(cardOnly, { parents: cardRoot, target: 0, env })), {
	expected: '#f00',
	label: 'engine resurrects after dispose',
});
inlineEngine.release();
layerEngine.release();
engine.release();
console.log('engine ok');

console.log('smoke ok');

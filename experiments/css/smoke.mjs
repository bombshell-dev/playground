// Smoke test: drive the ergonomic API through the package entry, against
// the embedded artifact.
// Usage: node smoke.mjs

import { component, compile, compute, computeTree, release, decodeIr, createEngine, NO_PARENT } from './src/index.js';

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
const env = { viewportWidth: 400, viewportHeight: 300, colorScheme: 'dark', reducedMotion: false, resolution: 1 };
for (const target of [0, 1, 2]) {
  const computed = sheet.compute(tree, parents, target, env);
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
  perNode.push(sheet.compute(tree, parents, target, env));
}
const wholeViaSheet = sheet.computeTree(tree, parents, env);
const whole = computeTree(sheet, tree, parents, env);
if (JSON.stringify(perNode) !== JSON.stringify(wholeViaSheet)) {
  throw new Error('Sheet.computeTree disagrees with Sheet.compute');
}
if (JSON.stringify(perNode) !== JSON.stringify(whole)) {
  throw new Error('module-level computeTree disagrees with compute');
}

// Re-compile + release exercises the slot lifecycle before the loop.
const otherSheet = compile('.x { color: blue }', 2);
otherSheet.compute(tree, parents, 2, env);
otherSheet.release();
for (let i = 0; i < 500; i++) {
  sheet.compute(tree, parents, 2, env);
}
if (memoryPages() !== memoryPages()) throw new Error('unstable');
const pagesAfterFrames = memoryPages();
for (let i = 0; i < 500; i++) {
  for (const target of tree.keys()) {
    sheet.compute(tree, parents, target, env);
  }
  sheet.computeTree(tree, parents, env);
}
const growth = memoryPages() - pagesAfterFrames;
console.log(`frame loop: 5500 computes, memory grew ${growth} bytes`);
if (growth > 0) {
  throw new Error(`per-frame leak: ${growth} bytes over 500 frames`);
}

// Option-returning calls after compute-tree: the shared return area holds a
// pointer from compute-tree's lowering, so the option discriminant's padding
// bytes are no longer zero. Reading the disc as anything wider than one byte
// misreads these results as absent.
const hotSheet = compile('.card { color: #fff }', 2);
hotSheet.compute(tree, parents, 1, env);
hotSheet.release();

// The rest of the poison matrix: re-compiling the ORIGINAL css…
const reSheet = compile(css, 2);
// …and computing on a sheet adopted after compute-tree.
const adoptedSheet = compile('.card { color: #0f0 }', 2);
const afterPoison = adoptedSheet.computeTree(tree, parents, env);
if (afterPoison.length !== tree.length || afterPoison[1].length === 0) {
  throw new Error(`compute-tree on a late-prepared sheet returned no styles: ${JSON.stringify(afterPoison)}`);
}
reSheet.release();
adoptedSheet.release();

// Diagnostics surface through the API: an invalid color warns and the rest
// of the rule recovers — the compile still succeeds.
const warned = compile('.card { color: notacolor; padding: 4px }', 2);
if (
  !warned.diagnostics.some(
    (d) => d.severity === 1 && d.code === 'declaration' && d.message.includes('notacolor'),
  )
) {
  throw new Error(`expected a warning diagnostic, got ${JSON.stringify(warned.diagnostics)}`);
}
warned.release();

// Disposable protocol: release is synchronous, so `using` works via
// Symbol.dispose and `await using` via Symbol.asyncDispose. (The `using`
// syntax itself is exercised in smoke.using.mjs on Node 24+/bun.)
{
  const scoped = compile('.card { color: red }', 2);
  if (scoped.compute(tree, parents, 1, env).length === 0) {
    throw new Error('scoped sheet returned no styles');
  }
  scoped[Symbol.dispose]();
  if (scoped.handle !== null) throw new Error('Symbol.dispose did not drop the handle');
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
function assertColor(actual, expected, label) {
	if (actual !== expected) {
		throw new Error(`${label}: expected color ${expected}, got ${actual}`);
	}
}

const cardOnly = [{ tag: 'card', classes: ['card'] }];
const cardRoot = [NO_PARENT];

// Later sheets win at equal specificity (document order). Colors come back
// canonicalized (named → shortest hex), so assert canonical values.
const engine = createEngine();
engine.addSheet('.card { color: #0f0 }');
engine.addSheet('.card { color: #f00 }');
assertColor(colorOf(engine.compute(cardOnly, cardRoot, 0, env)), '#f00', 'sheet order');

// Each sheet compiles once; removal reverts to the prior cascade.
const whiteId = engine.addSheet('.card { color: #123456 }');
assertColor(colorOf(engine.compute(cardOnly, cardRoot, 0, env)), '#123456', 'added sheet');
if (engine.removeSheet(whiteId) !== true) throw new Error('removeSheet failed');
assertColor(colorOf(engine.compute(cardOnly, cardRoot, 0, env)), '#f00', 'after removeSheet');

// @layer across sheets: layers rank by first appearance (later wins), and
// re-referencing an earlier layer must NOT reorder it to the end — that's
// the discriminator the concatenation scheme has to preserve.
const layerEngine = createEngine();
const bId = layerEngine.addSheet('@layer b { .card { color: #0f0 } }');
const aId = layerEngine.addSheet('@layer a { .card { color: #ff0 } }');
const plainId = layerEngine.addSheet('.card { color: #234567 }');
assertColor(colorOf(layerEngine.compute(cardOnly, cardRoot, 0, env)), '#234567', 'unlayered wins');
layerEngine.removeSheet(plainId);
assertColor(colorOf(layerEngine.compute(cardOnly, cardRoot, 0, env)), '#ff0', 'later layer wins');
const bAgain = layerEngine.addSheet('@layer b { .card { color: #00f } }');
assertColor(colorOf(layerEngine.compute(cardOnly, cardRoot, 0, env)), '#ff0', '@layer first-appearance survives re-reference');

// Inline styles: inline-normal beats sheet-normal, sheet-!important beats
// inline-normal, inline-!important beats everything. Inline values pass
// through un-canonicalized.
const inlineEngine = createEngine();
inlineEngine.addSheet('.card { color: #fff; background: black }');
inlineEngine.addSheet('.card { color: #f00 !important }');
const inlineNode = [{ tag: 'card', classes: ['card'], style: 'color: blue; border: none' }];
const inlineImp = [{ tag: 'card', classes: ['card'], style: 'color: blue !important' }];
assertColor(colorOf(inlineEngine.compute(inlineNode, cardRoot, 0, env)), '#f00', 'sheet !important beats inline');
assertColor(colorOf(inlineEngine.compute(inlineImp, cardRoot, 0, env)), 'blue', 'inline !important wins');
const noShield = createEngine();
noShield.addSheet('.card { color: #fff }');
assertColor(colorOf(noShield.compute(inlineNode, cardRoot, 0, env)), 'blue', 'inline beats sheet-normal');
if (noShield.compute(inlineNode, cardRoot, 0, env).some(([n, v]) => n === 'border' && v !== 'none')) {
	throw new Error('inline border not applied');
}
// An !important in a rule that does NOT match the node must not shield:
// the inline style still wins (impossible under the old JS-side merge).
const wrongShield = createEngine();
wrongShield.addSheet('.other { color: #f00 !important }');
wrongShield.addSheet('.card { color: #fff }');
assertColor(colorOf(wrongShield.compute(inlineNode, cardRoot, 0, env)), 'blue', 'non-matching !important does not shield');
// Inline declarations seed inheritance: the child inherits the parent's
// inline-overridden custom property.
const inheritEngine = createEngine();
inheritEngine.addSheet('.child { color: var(--brand) }');
const inheritTree = [
	{ tag: 'root', style: '--brand: red' },
	{ tag: 'child', classes: ['child'] },
];
assertColor(colorOf(inheritEngine.computeTree(inheritTree, [NO_PARENT, 0], env)[1]), 'red', 'inline custom property inherits');
noShield.release();
wrongShield.release();
inheritEngine.release();

// Engine dispose releases the sheet; a later compute lazily re-prepares.
inlineEngine[Symbol.dispose]();
assertColor(colorOf(inlineEngine.compute(cardOnly, cardRoot, 0, env)), '#f00', 'engine resurrects after dispose');
inlineEngine.release();
layerEngine.release();
engine.release();
console.log('engine ok');

console.log('smoke ok');

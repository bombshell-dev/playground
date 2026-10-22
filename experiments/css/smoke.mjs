// Smoke test: drive the ergonomic API through the package entry, against
// the embedded artifact.
// Usage: node smoke.mjs

import { component, compile, prepare, compute, computeTree, release, decodeIr, NO_PARENT } from './src/index.js';

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

const { ir, diagnostics } = compile(css, 2);
console.log('diagnostics:', diagnostics.length ? diagnostics : 'none');
if (!ir) {
  throw new Error('compile returned no IR');
}
console.log('ir bytes:', ir.byteLength);
const sheet = prepare(ir);

const parsed = decodeIr(ir);
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

// Re-prepare + release exercises the slot lifecycle before the loop.
const other = compile('.x { color: blue }', 2);
const otherSheet = prepare(other.ir);
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
const hot = compile('.card { color: #fff }', 2);
if (hot.ir === null) {
  throw new Error('compile after compute-tree reported no IR');
}
const hotSheet = prepare(hot.ir);
hotSheet.release();

// The rest of the poison matrix: re-preparing the ORIGINAL IR bytes…
const reSheet = prepare(ir);
// …and computing on a sheet adopted after compute-tree.
const adopted = compile('.card { color: #0f0 }', 2);
if (adopted.ir === null) {
  throw new Error('compile after compute-tree reported no IR');
}
const adoptedSheet = prepare(adopted.ir);
const afterPoison = adoptedSheet.computeTree(tree, parents, env);
if (afterPoison.length !== tree.length || afterPoison[1].length === 0) {
  throw new Error(`compute-tree on a late-prepared sheet returned no styles: ${JSON.stringify(afterPoison)}`);
}
reSheet.release();
adoptedSheet.release();

// Disposable protocol: release is synchronous, so `using` works via
// Symbol.dispose and `await using` via Symbol.asyncDispose. (The `using`
// syntax itself is exercised in smoke.using.mjs on Node 24+/bun.)
{
  const scoped = prepare(compile('.card { color: red }', 2).ir);
  if (scoped.compute(tree, parents, 1, env).length === 0) {
    throw new Error('scoped sheet returned no styles');
  }
  scoped[Symbol.dispose]();
  if (scoped.handle !== null) throw new Error('Symbol.dispose did not drop the handle');
  scoped.release(); // double release is a safe no-op
  await scoped[Symbol.asyncDispose]();
}

// Diagnostics surface through the ABI: an invalid color warns and the rest
// of the rule recovers.
const warned = compile('.card { color: notacolor; padding: 4px }', 2);
if (
  warned.ir === null ||
  !warned.diagnostics.some(
    (d) => d.severity === 1 && d.code === 'declaration' && d.message.includes('notacolor'),
  )
) {
  throw new Error(`expected a warning diagnostic, got ${JSON.stringify(warned.diagnostics)}`);
}

sheet.release();
console.log('smoke ok');

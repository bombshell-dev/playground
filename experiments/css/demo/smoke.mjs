// Smoke test: drive the raw canonical ABI from Node.
// Usage: node demo/smoke.mjs [path-to-wasm]

import { readFileSync } from 'node:fs';
import { loadCssComponent, decodeIr, NO_PARENT } from './abi.js';

const path = process.argv[2] ?? new URL('./bombshell_css_wasm.wasm', import.meta.url).pathname;
const component = await loadCssComponent(readFileSync(path));

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

const { ir, diagnostics } = component.compile(css, 2);
console.log('diagnostics:', diagnostics.length ? diagnostics : 'none');
if (!ir) {
  throw new Error('compile returned no IR');
}
console.log('ir bytes:', ir.byteLength);
const sheet_handle = component.prepare(ir);
if (sheet_handle === null) {
  throw new Error('prepare rejected the IR');
}

const sheet = decodeIr(ir);
console.log('ir version:', sheet.version);
for (const rule of sheet.rules) {
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
  const computed = component.compute(sheet_handle, tree, parents, target, env);
  console.log(`node ${target}:`, JSON.stringify(computed));
}

// Frame loop: `compute` runs per animation frame in real hosts, so its
// memory must not grow over time. The component caches the parsed sheet for
// identical IR bytes; a growing trace means the cache is leaking.
function memoryPages() {
  return component.raw.memory.buffer.byteLength;
}
// The tree API must agree with the per-node API.
const perNode = [];
for (const target of tree.keys()) {
  perNode.push(component.compute(sheet_handle, tree, parents, target, env));
}
const whole = component.computeTree(sheet_handle, tree, parents, env);
if (JSON.stringify(perNode) !== JSON.stringify(whole)) {
  throw new Error('computeTree disagrees with compute');
}

// Re-prepare + release exercises the slot lifecycle before the loop.
const other = component.compile('.x { color: blue }', 2);
const other_handle = component.prepare(other.ir);
component.compute(other_handle, tree, parents, 2, env);
component.release(other_handle);
for (let i = 0; i < 500; i++) {
  component.compute(sheet_handle, tree, parents, 2, env);
}
if (memoryPages() !== memoryPages()) throw new Error('unstable');
const pagesAfterFrames = memoryPages();
for (let i = 0; i < 500; i++) {
  for (const target of tree.keys()) {
    component.compute(sheet_handle, tree, parents, target, env);
  }
  component.computeTree(sheet_handle, tree, parents, env);
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
const hot = component.compile('.card { color: #fff }', 2);
if (hot.ir === null) {
  throw new Error('compile after compute-tree reported no IR');
}
const hotHandle = component.prepare(hot.ir);
if (hotHandle === null) {
  throw new Error('prepare after compute-tree rejected valid IR');
}
component.release(hotHandle);

// The rest of the poison matrix: re-preparing the ORIGINAL IR bytes…
const rePrepare = component.prepare(ir);
if (rePrepare === null) {
  throw new Error('re-prepare of the existing IR rejected valid bytes');
}
// …and computing on a sheet adopted after compute-tree.
const adopted = component.compile('.card { color: #0f0 }', 2);
if (adopted.ir === null) {
  throw new Error('compile after compute-tree reported no IR');
}
const adoptedHandle = component.prepare(adopted.ir);
if (adoptedHandle === null) {
  throw new Error('prepare after compute-tree rejected valid IR');
}
const afterPoison = component.computeTree(adoptedHandle, tree, parents, env);
if (afterPoison.length !== tree.length || afterPoison[1].length === 0) {
  throw new Error(`compute-tree on a late-prepared sheet returned no styles: ${JSON.stringify(afterPoison)}`);
}
component.release(rePrepare);
component.release(adoptedHandle);

// Diagnostics surface through the ABI: an invalid color warns and the rest
// of the rule recovers.
const warned = component.compile('.card { color: notacolor; padding: 4px }', 2);
if (
  warned.ir === null ||
  !warned.diagnostics.some(
    (d) => d.severity === 1 && d.code === 'declaration' && d.message.includes('notacolor'),
  )
) {
  throw new Error(`expected a warning diagnostic, got ${JSON.stringify(warned.diagnostics)}`);
}

component.release(sheet_handle);
console.log('smoke ok');

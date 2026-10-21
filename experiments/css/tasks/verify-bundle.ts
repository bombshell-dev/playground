// Verifies the encoded artifact end-to-end: instantiate the compiled module
// exported by wasm.ts and replay the demo smoke assertions through it.
// Usage: deno run --allow-read --allow-write tasks/verify-bundle.ts

import { loadCssComponentFromModule, decodeIr, NO_PARENT } from "../demo/abi.js";
import { compiled } from "../wasm.ts";

const component = loadCssComponentFromModule(compiled);

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
  { tag: 'root', classes: ['root', 'panel'], width: 400, height: 100, state: 0 },
  { tag: 'card', classes: ['card'] },
  { tag: 'title', classes: ['title'] },
];
const parents = [NO_PARENT, 0, 1];

const env = { viewportWidth: 400, viewportHeight: 300, colorScheme: 'dark', reducedMotion: false, resolution: 1 };

const perNode = [];
for (const target of tree.keys()) {
  perNode.push(component.compute(sheet_handle, tree, parents, target, env));
}
const whole = component.computeTree(sheet_handle, tree, parents, env);
if (JSON.stringify(perNode) !== JSON.stringify(whole)) {
  throw new Error('computeTree disagrees with compute');
}
if (!whole[1].some(([name, value]) => name === 'border-color' && value === 'oklch(70% .2 40)')) {
  throw new Error(`container query did not cascade: ${JSON.stringify(whole[1])}`);
}

const other = component.compile('.x { color: blue }', 2);
const other_handle = component.prepare(other.ir);
component.compute(other_handle, tree, parents, 2, env);
component.release(other_handle);

function memoryPages() {
  return component.raw.memory.buffer.byteLength;
}
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
component.release(sheet_handle);
console.log('bundle ok');

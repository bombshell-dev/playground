// Smoke test for the explicit-resource-management path: `using` /
// `await using` auto-release sheets at scope exit. Requires Node 24+ or bun
// (Node 22 needs the flag and does not parse `using`).
// Usage: node smoke.using.mjs

import assert from 'node:assert/strict';
import { component, compile, prepare, NO_PARENT } from './src/index.js';

const tree = [
  { tag: 'root', classes: ['root'], width: 400, height: 100, state: 0 },
  { tag: 'card', classes: ['card'] },
];
const parents = [NO_PARENT, 0];
const env = { viewportWidth: 400, viewportHeight: 300, colorScheme: 'dark', reducedMotion: false, resolution: 1 };

// Sync `using`: the sheet is released when the block exits.
{
  using sheet = prepare(compile('.card { color: red }', 2).ir);
  assert(sheet.compute(tree, parents, 1, env).some(([name]) => name === 'color'));
}
const pagesAfterSync = component.raw.memory.buffer.byteLength;

// `await using` also works — release is synchronous but the protocol accepts it.
{
  await using sheet = prepare(compile('.card { color: blue }', 2).ir);
  assert(sheet.compute(tree, parents, 1, env).some(([name]) => name === 'color'));
}

// Neither sheet leaked: a second compile/prepare/compute round still works
// and memory has not grown beyond the sheets we hold open.
{
  using sheet = prepare(compile('.card { color: green }', 2).ir);
  assert(sheet.compute(tree, parents, 1, env).some(([name]) => name === 'color'));
}
assert(component.raw.memory.buffer.byteLength <= pagesAfterSync + 65536 * 4);

console.log('using-smoke ok');

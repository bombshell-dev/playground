// Smoke test for the explicit-resource-management path: `using` /
// `await using` auto-release sheets at scope exit. Requires Node 24+ or bun
// (Node 22 needs the flag and does not parse `using`).
// Usage: node smoke.using.mjs

import assert from 'node:assert/strict';
import { component, compile, decodeIr } from './src/index.js';

const tree = [
  { tag: 'root', classes: ['root'], width: 400, height: 100, state: 0 },
  { tag: 'card', classes: ['card'] },
];
const parents = [0xffffffff, 0];
const env = { viewportWidth: 400, viewportHeight: 300, colorScheme: 'dark', reducedMotion: false, resolution: 1 };

// Sync `using`: compile prepares and returns the Sheet; released at block exit.
{
  using sheet = compile('.card { color: red }');
  assert(sheet.diagnostics.length === 0);
  assert(sheet.compute(tree, parents, 1, env).some(([name]) => name === 'color'));
  assert(sheet.rules.length > 0);
  assert(decodeIr(sheet).version === 2);
}
const pagesAfterSync = component.raw.memory.buffer.byteLength;

// `await using` also works — release is synchronous but the protocol accepts it.
{
  await using sheet = compile('.card { color: blue }');
  assert(sheet.compute(tree, parents, 1, env).some(([name]) => name === 'color'));
}

// Neither sheet leaked: a third round still works and memory has not grown
// beyond the sheets we hold open.
{
  using sheet = compile('.card { color: green }');
  assert(sheet.compute(tree, parents, 1, env).some(([name]) => name === 'color'));
}
assert(component.raw.memory.buffer.byteLength <= pagesAfterSync + 65536 * 4);

console.log('using-smoke ok');

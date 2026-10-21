// Benchmarks against the shipped component: compile throughput and the
// per-frame `compute` path real hosts drive. The corpus is generated
// deterministically, so numbers are comparable across machines and runs.
import { readFileSync } from "node:fs";
import { loadCssComponent, decodeIr, NO_PARENT } from "./abi.js";

const component = await loadCssComponent(
  readFileSync(new URL("./bombshell_css_wasm.wasm", import.meta.url)),
);

// A synthetic-but-realistic stylesheet: 1140 top-level class rules cycling
// real property/value shapes, plus nesting, media, container, keyframes,
// and supports blocks in the mix.
const PROPS = [
  ["color", ["red", "#34a", "oklch(70% .2 40)", "rgb(10 20 30 / 50%)"]],
  ["background-color", ["transparent", "light-dark(white, black)"]],
  ["margin", ["0", "4px", "1.5rem", "8px 16px"]],
  ["padding", ["0 auto", "2px 4px 6px"]],
  ["font-size", ["12px", "1.25rem", "100%"]],
  ["border-color", ["red", "color-mix(in oklab, red 40%, blue)"]],
  ["width", ["auto", "100px", "50%", "min(10px, 2em)"]],
  ["display", ["block", "flex", "none"]],
  ["opacity", ["1", ".5"]],
  ["--custom", ["var(--x, 1px)", "oklch(50% .1 200)"]],
];
const VARIANTS = [
  (n) => `.c${n}`,
  (n) => `.c${n}:hover`,
  (n) => `.c${n}[data-x='${n}']`,
  (n) => `.c${n} > .child`,
  (n) => `:is(.c${n}, .c${n + 1})`,
  (n) => `.c${n}:nth-child(2n + 1)`,
];
let css = "";
let n = 0;
while (n < 1140) {
  const [prop, values] = PROPS[n % PROPS.length];
  const value = values[(n / PROPS.length) % values.length | 0];
  css += `${VARIANTS[n % VARIANTS.length](n)} { ${prop}: ${value} }\n`;
  n++;
}
css += `@media (min-width: 24em) { ${VARIANTS[0](n)} { ${PROPS[0][0]}: blue } ${VARIANTS[1](n + 1)} { ${PROPS[2][0]}: 2px } }\n`;
n += 2;
css += `@container panel (inline-size > 20em) { .c${n} { ${PROPS[5][0]}: green } }\n`;
n += 1;
css += `.panel { container-type: inline-size; container-name: panel }\n`;
css += `.card { padding: 4px; & > .title { font-weight: bold } .body { margin: 0 } }\n`;
css += `@layer base { .c${n} { ${PROPS[0][0]}: red } .c${n + 1} { ${PROPS[3][0]}: 1px } }\n`;
n += 2;
css += `@supports (color: oklch(50% .1 200)) { .c${n} { ${PROPS[0][0]}: oklch(50% .1 200) } }\n`;
n += 1;
css += `@keyframes pulse { 0% { opacity: 1 } 100% { opacity: 0 } }\n`;
css += `.c${n} { ${PROPS[8][0]}: var(--x, .4) }\n`;

// ---------------------------------------------------------------------------
// Compile throughput
// ---------------------------------------------------------------------------

const run = () => component.compile(css, "author");

for (let i = 0; i < 5; i++) run();

const N = 50;
const times = [];
let rules = 0;
for (let i = 0; i < N; i++) {
  const start = performance.now();
  const result = run();
  times.push(performance.now() - start);
  if (i === 0) {
    const ir = decodeIr(result.ir);
    rules = ir.rules.length;
  }
}
times.sort((a, b) => a - b);
const median = times[N >> 1];
console.log(
  `compile (wasm): median ${median.toFixed(2)} ms → ${(css.length / 1024 / median * 1000).toFixed(1)} KB/s (${rules} rules)`,
);

// ---------------------------------------------------------------------------
// Per-frame compute: a UI-shaped tree over the corpus's own class names
// ---------------------------------------------------------------------------

const compiled = run();
const ir = compiled.ir;
const sheet = decodeIr(ir);
const handle = component.prepare(ir);
if (handle === null) throw new Error("prepare rejected the IR");

// Class vocabulary from the compiled selectors, most frequent first.
const freq = new Map();
for (const rule of sheet.rules) {
  for (const match of rule.selector.matchAll(/\.([A-Za-z][\w-]*)/g)) {
    freq.set(match[1], (freq.get(match[1]) ?? 0) + 1);
  }
}
const classes = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
if (classes.length === 0) classes.push("node");

// A plausible UI tree: a container panel with a grid of cards, each with a
// title and a couple of children — 1 + 4 + 4*(1+3) = 21 nodes, sizes set on
// the container so size queries can match.
const tree = [{ tag: "root", classes: [classes[0]], width: 1024, height: 768, state: 0 }];
const parents = [NO_PARENT];
const panel = tree.length;
tree.push({ tag: "panel", classes: [classes[1] ?? classes[0]], width: 1024, height: 768, state: 0 });
parents.push(0);
for (let i = 0; i < 4; i++) {
  const card = tree.length;
  tree.push({ tag: "card", classes: [classes[i % classes.length]], state: i === 1 ? 1 : 0 });
  parents.push(panel);
  for (let j = 0; j < 3; j++) {
    tree.push({ tag: "text", classes: [classes[(i + j + 2) % classes.length]], state: 0 });
    parents.push(card);
  }
}

const env = { viewportWidth: 1024, viewportHeight: 768, colorScheme: "dark", reducedMotion: false, resolution: 1 };

// Warm.
for (const target of tree.keys()) component.compute(handle, tree, parents, target, env);

const FRAMES = 100;
const frameTimes = [];
for (let f = 0; f < FRAMES; f++) {
  const start = performance.now();
  component.computeTree(handle, tree, parents, env);
  frameTimes.push(performance.now() - start);
}
frameTimes.sort((a, b) => a - b);
const frame = frameTimes[FRAMES >> 1];
console.log(
  `compute-tree (wasm): median ${frame.toFixed(3)} ms/frame → ${(frame * 1000 / tree.length).toFixed(1)} µs/node × ${tree.length} nodes`,
);

// Memory stability: a frame loop must not grow linear memory.
const before = component.raw.memory.buffer.byteLength;
for (let f = 0; f < 2000; f++) {
  component.computeTree(handle, tree, parents, env);
}
const growth = component.raw.memory.buffer.byteLength - before;
console.log(`compute loop: 2000 frames, memory grew ${growth} bytes`);
if (growth !== 0) throw new Error(`per-frame leak: ${growth} bytes`);
component.release(handle);

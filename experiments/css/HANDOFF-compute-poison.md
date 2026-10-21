# Handoff: `compute_tree` poisons later `compile` **and** `prepare` calls

For an agent picking up the Bombshell CSS engine (`natemoo-re/css`). Written 2026-10-12 from the consuming side (`bombshell-dev/ui`, package `@clack/ui`). Companion doc: `BUGS-from-ui-bridge.md` (same repo) — read it first; this extends it with new findings and the fix brief.

## The one-paragraph brief

One `compute_tree` call puts the whole wasm component into a state where every later `compile` **and** `prepare` silently returns null/empty (empty `diagnostics` — the silence is part of the bug). Sheets that already exist keep computing forever, so the per-frame path is fine; what breaks is any stylesheet adoption after the first frame. The UI bridge ships a host-side workaround (fresh component re-instantiation per compile batch) that this fix should make deletable. Fix the engine, prove it in the conformance corpus + smoke, then the UI deletes the workaround.

## Repos, versions, artifacts

- Engine: `/Users/nmoo/Developer/natemoo-re/css` — Rust workspace, crates: `css-core` (IR encode/decode, types), `css-compiler` (source → IR, lexbor front-end), `css-runtime` (prepare/cascade/compute), `css-wasm` (the WIT component adapter), `css-conformance` (corpus tests). WIT contract: `wit/css.wit`, interface `bombshell:css/stylesheet@0.3.0`.
- Consumer: `/Users/nmoo/Developer/bombshell-dev/ui`, package `@clack/ui` — vendored the built artifact at `packages/ui/src/css/bombshell-css.wasm`, ABI bindings in `packages/ui/src/css/abi.ts` (adapted from `demo/abi.js`).
- Artifact state: `demo/bombshell_css_wasm.wasm` == `packages/ui/dist/bombshell-css.wasm` == `packages/ui/src/css/bombshell-css.wasm` (md5 `858bcb0c23f8881a8c87254a23418b6a`, 214,412 bytes). Any rebuild should be copied into the ui package (both `src/css/` and `dist/`; the ui build does `cp -f src/css/bombshell-css.wasm dist/`).

## The full poison matrix (measured 2026-10-12, fresh process each row)

| sequence | result |
| --- | --- |
| compile → prepare → compute-tree ×N (same sheets) | ✓ stable — 100+ computes, identical output |
| compile → prepare → compute-tree → **compile** | `ir: null`, `diagnostics: []` (known, Bug 3) |
| compile → prepare → compute-tree → **prepare(existing IR bytes)** | **`prepare → null` — NEW** |
| fresh component → `prepare` (the same IR bytes that failed above) | ✓ works — the IR is fine, the component state is not |
| fresh component → `compile` | ✓ works |
| compute-tree with a sheet prepared *after* the poison | returns **0 node results** (empty per-node lists) |

Key new facts:

1. **`prepare` joins `compile` in the poisoned set.** It isn't a compiler-side arena; whatever `compute_tree` leaves behind breaks *both* entry points that allocate at call start.
2. **`compute` itself keeps working after the poison** (alloc/free cycles per call succeed — the smoke's "compiles once, computes many" is why CI never saw this). So the global allocator is not broadly corrupted; the failure is specific to what `compile`/`prepare` do first — both go through the compiler/decode front doors that `compute_tree` never re-enters.
3. Failures are **silent**: `diagnostics: []` on every path. Whatever the fix is, a non-recoverable internal state should at minimum emit a diagnostic (or panic — this is a guest module; a loud abort beats silent data loss).

## Suspect area and leads

- Adapter: `crates/css-wasm/src/lib.rs` (232 lines — read it whole).
  - `prepare` decodes IR and `Box::leak`s it into a `SHEETS` slot (`thread_local!` `RefCell<Vec<Option<SheetSlot>>>`); `release` reconstructs + frees. Decode allocates through the global allocator.
  - `compile` → `bombshell_css_compiler::compile(&css, origin, CompileOptions::default())` + `encode_ir`.
  - `compute_tree` → `bombshell_css_runtime::cascade::compute_tree`, then the canonical-ABI lift of `list<list<computed-property>>` — wit-bindgen **frees the lifted lists via `cabi_post_*` hooks**. The bug doc's theory ("allocator/arena state, the compute-tree's lifted-list frees, that compile's next call walks into") is consistent with prepare also dying: both begin by allocating from whatever state the lifts/frees disturbed.
- Recent commits on the exact machinery (suspect range):
  - `a8203e6` — "Serialize CSS tokens through one shared writer"
  - `a7eba99` — "Pack the color and known-property tables into blobs"
  - `eddd906` — "Drop dead Ordering imports from the packed tables" (HEAD)
  - Also relevant context: `c0d9fe6` "Make the runtime a per-frame engine: rule index, borrowed cascade, tree API" — the per-frame rework that compute_tree belongs to.
- Things worth instrumenting first: the first allocation each of `compile`/`prepare` performs after a `compute_tree`; the `cabi_post_bombshell:css/stylesheet@0.3.0#compute-tree` free path; whether the blob-packed tables are built in scratch memory that `compute_tree`'s frees disturb; whether `SHEETS` slot bookkeeping (the `slots.push(None)` growth in `prepare`) collides with anything compute_tree wrote.

## How to reproduce

`demo/` has the reference host harness (`abi.js`, `smoke.mjs`). Minimal repro (fresh process):

```js
const component = await loadCssComponent(readFileSync('./demo/bombshell_css_wasm.wasm'));
const ua = component.compile('div { color: red; padding: 1px }', 0);
const sheet = component.prepare(ua.ir);           // works
component.computeTree(sheet, nodes, parents, env); // one call is enough
console.log(component.compile('div { color: red }', 2));   // → ir: null, diagnostics: []
console.log(component.prepare(ua.ir));                     // → null (NEW)
```

`nodes`/`parents`/`env` shapes are in `demo/abi.js` (`CssNode` 56-byte stride encode; `parents = [NO_PARENT, 0, …]`; env = `{ viewportWidth, viewportHeight, colorScheme: 'dark', reducedMotion, resolution }`).

Expected after the fix: both calls return live values; the poisoned-handle compute path (sheet handle reused post-release) either works or errors loudly.

## Definition of done

1. Engine: a unit/conformance test reproducing the matrix above goes green. Extend `css-conformance` and `demo/smoke.mjs` with the compile→compute→compile/prepare-again sequence so the corpus can't regress. The repo already has uncommitted corpus additions for Bugs 1/2 (`crates/css-conformance/cases/colors/02-hex.css`, `cases/values/02-single-line.css`) — keep them.
2. Loud failure mode: internal-bail paths surface a diagnostic (or guest abort), never a silent empty return.
3. No measurable perf/size regression on the hot path: per-frame `compute_tree` is ~0.02 ms for a 3-node tree today (0.020 ms measured, avg of 1000); keep it within noise. Artifact is size-golfed (nightly `-Cpanic=immediate-abort -Zlocation-detail=none -Zfmt-debug=none` + double `wasm-opt -Oz`, see `demo/build.sh`) — report the new byte count; ui copies it verbatim.
4. Consumer-side cleanup (may be a separate step): `bombshell-dev/ui` `packages/ui/src/css/bridge.ts` deletes the workaround in `#recompile` (the `createCssComponentSync` fresh-instantiation per compile batch, currently ~lines 168–193) and prepares new sheets on the long-lived component; `packages/ui/src/css/bridge.test.ts` (16 files / 213 tests, all green at time of writing) plus the headless E2E (`examples/dom-demo`: `node --experimental-strip-types src/headless.ts`) must stay green.

## Perf baseline (for the comparison after your fix)

| operation | today |
| --- | --- |
| wasm instantiate (full reload) | 0.151 ms |
| compile, 1.2 KB sheet (UA) | 0.070 ms |
| compile, 740 B sheet | 0.034 ms |
| compile, 60 KB / 500 rules | 4.85 ms |
| prepare, same three sheets | 0.024 / 0.010 / 1.71 ms |
| compute-tree, 3 nodes | 0.020 ms |

(Precompiling CSS to IR at build time is *not* a substitute for this fix — prepare is poisoned too; the poison fix is the real one. IR portability across instances is confirmed, so a future build-time `.css.ir` artifact path is viable once this lands.)

## Working agreements

- The repo has **uncommitted work** (canonical.rs, lib.rs, behavior.rs, demo/abi.js, smoke.mjs + two corpus cases) — it is the in-flight Bugs 1/2 fix; build on it, don't revert it.
- IR/ABI changes require bumping the WIT version (`@0.3.0`) only if the IR format itself changes; a pure state-fix shouldn't.
- Node 22+/24 host, wasm target `wasm32-unknown-unknown`, nightly toolchain required by `demo/build.sh`.

# Bug report: compile/compute regressions hit from the UI DOM bridge

_From the bombshell-dev/ui spike (DOM core + CSS bridge). Written 2026-10-12. Reproed against `demo/bombshell_css_wasm.wasm` (214,025 bytes, md5 `e2848c97d90ece5153e05a096ada3a2d`) + unmodified `demo/abi.js` — the exact artifact/ABI the smoke test passes with (`node demo/smoke.mjs` → all green, 5500 computes, 0 memory growth)._

Two independent failures, both silently (empty `diagnostics`):

## Bug 3 — `compute_tree` poisons subsequent `compile` calls (the big one)

Minimal sequence, fresh process:

```js
const ua = component.compile('tui-button { display: flex; border: 1px solid #3a3a46; cursor: pointer }', 0);
const uaSheet = ua.ir && component.prepare(ua.ir);
component.computeTree(uaSheet, nodes, parents, env);      // one compute is enough
const author = component.compile('tui-text { color: red }', 2);
console.log(author.ir);                                    // → null, diagnostics: []
```

Controls (same component code paths, minus one step each):

| sequence | second compile |
| --- | --- |
| compile → prepare → **compute_tree** → compile | **ir: null** (silent) |
| compile → prepare → compile | ir: 34 ✓ |
| compile → compile (no prepare) | ir: 34 ✓ |

So one `compute_tree` call breaks every later `compile` — with empty diagnostics. This is why the smoke suite can't see it: it compiles once, computes many. The UI bridge compiles at runtime (hot adoption) and hits it constantly. Host-side workaround in place (fresh component re-instantiation per compile batch, `createCssComponentSync`), but the real fix belongs here — my guess is allocator/arena state (the compute-tree's lifted-list frees) that `compile`'s next call walks into, possibly related to the recent table-packing commits.

Repro: the three-line sequence above against `demo/bombshell_css_wasm.wasm` (md5 `858bcb0c23f8881a8c87254a23418b6a`).

## Bug 1 — single-line stylesheet compiles to NO IR

```js
component.compile('.card { color: #fff; padding: 4px }', 2) // → { ir: null, diagnostics: [] }
component.compile('.card {\n  color: #fff;\n  padding: 4px;\n}', 2) // → { ir: <74 bytes>, diagnostics: [] }
```

Identical CSS modulo whitespace/newlines. The single-line form produces **no IR and no diagnostics** — `prepare` then rejects (`null`), and the host can't tell the user why. Looks like a token-level event from the lexbor shim being lost when the rule body ends on the same line it starts (the smoke's stylesheet — like all real stylesheets — is multiline, which is why the corpus doesn't catch it). Suggests a conformance-corpus gap: add single-line-rule cases to `css-conformance/cases/`.

## Bug 2 — hex color declarations: dropped from computed, or NO IR, depending on digit count

Matrix (each row a fresh process, multiline sheet `.card {\n  <decl>;\n}`, compute-tree on one `.card` node):

| declaration | compile | computed |
| --- | --- | --- |
| `color: red` | ✓ | `color: red` present ✓ |
| `color: rgb(40 40 48)` | ✓ | present ✓ |
| `color: light-dark(white, black)` (smoke) | ✓ | `color: #fff` present ✓ |
| `background-color: #101010` | ✓ | present ✓ |
| `border-color: rgb(40 40 48)` | ✓ | present ✓ |
| `color: #fff` | ✓ | **declaration vanishes** (computed `[[]]`) |
| `color: #ff8800` | ✓ | **declaration vanishes** |
| `color: #ffffff` | **NO IR**, no diagnostics | — |
| `border-color: #333` | **NO IR**, no diagnostics | — |
| `border-color: #333333` | **NO IR**, no diagnostics | — |

So: named/functional colors are fine; a 3-digit hex on `color` compiles but the declaration is silently dropped downstream; 6-digit hex (and 3-digit hex on `border-color`) silently produce no IR at all. `background-color: #101010` (6-digit hex) surviving while `color: #ffffff` dies suggests the canonicalizer/path differs per property — likely a span/boundary issue around the `#` hex token in the lexbor shim's event stream for the `color`/`border-color` grammar specifically.

Guess at the culprit: the compiler's canonical value serialization for hex colors, or the runtime's declaration filter not recognizing the canonical form for those properties. Whatever it is, `diagnostics: []` on all the failures is its own bug — silent data loss.

Also observed (lower confidence, only if useful): running several `compile()` calls back-to-back in one process, the later ones occasionally produced `ir: null` as well (seen with single-line inputs) — could be entirely explained by Bug 1; flagging in case there's per-call state involved.

## Context: why the UI bridge cares

The ui DOM bridge feeds `compute-tree` a flat element snapshot per frame and merges the returned declarations onto tty render properties. `color`/`border-color` are *the* properties for terminal text and borders — Bug 2 makes stylesheet-driven terminal styling impossible for plain colors, and Bug 1 makes half of real-world CSS (minified/single-line sheets) silently no-op.

Repro script (run from `demo/`): the two snippets above; `demo/smoke.mjs` continues to pass, so any fix should be asserted by extending the corpus with: (a) single-line rules, (b) plain-hex color + border-color computed expectations.

— the ui-side spike

---

## Resolution (engine side, 2026-10-12)

All three bugs are fixed; the "engine poison" in Bug 3 was never engine state.

**Bug 3 (`compute_tree` "poisons" later `compile`/`prepare`): host-side ABI misread.**
The canonical ABI lowers `option<...>` results as a 1-byte discriminant followed
by 3 bytes of *undefined* padding (then the payload at +4). wit-bindgen's guest
shares one static return area across all exports, and `compute_tree` writes an
outer-list pointer there; a later `compile`/`prepare` writes its discriminant
over byte 0 and leaves the stale pointer fragments in bytes 1..3. The old host
readers (`demo/abi.js`, and the ui's `abi.ts` adapted from it) read the
discriminant as `u32` — so a fully successful guest result (`disc=1, handle=1`)
read as `0x00110201 ≠ 1` → "null", with the guest's real diagnostics never
examined. That is the entire poison matrix: fresh components work (zeroed
return area), `compute` is immune (no discriminant in its result), and the
same IR bytes work on a fresh component. Byte-level trace: after one
`compute_tree` whose outer list lives at `0x00110250`, the next `compile`
returns `01 02 11 00 …` — disc `1`, padding `02 11 00`, valid IR pointer and
length behind it.

Fixes: `demo/abi.js` and the ui's `packages/ui/src/css/abi.ts` now read the
discriminant with `getUint8`; the ui bridge's fresh-component-reload
workaround is deleted. The engine's wasm guest is unchanged — the rebuilt
artifact is byte-identical (214,412 bytes, md5 `858bcb0c23f8881a8c87254a23418b6a`).
Regression protection: `demo/smoke.mjs` asserts the full matrix
(compile/prepare/re-prepare after compute-tree, plus a sheet adopted and
computed after the compute window), and `css-conformance` pins the
library-level property (`compile_and_prepare_survive_compute_tree`).

Known limitations left as-is (WIT `@0.3.0` shapes, not regressions):
`prepare` has no diagnostics channel (invalid IR → `null` only), and
`compute`/`compute_tree` degrade to empty results for unknown handles —
handles are never invalidated on `release`, and a freed slot can be reused by
a later `prepare`, so a stale handle aliases the new sheet. Worth a `@0.4.0`
discussion someday; nothing here depends on it.

**Bug 1 (single-line stylesheets produce no IR): fixed in the compiler.**
The lexbor shim's token stream lost the rule-body-end event when the closing
brace sat on the rule's first line. Corpus case `values/02-single-line.css` +
behavior test.

**Bug 2 (hex colors dropped or NO IR): fixed in the compiler.**
Hex colors tokenize as `Hash` or `IDHash` depending on whether the payload
reads as an identifier; only `Hash` was recognized, and digit-count
validation was missing entirely. Both token forms are now accepted and
validated as 3/4/6/8 hex digits. Corpus case `colors/02-hex.css` + behavior
test; the smoke asserts hex reaches computed styles. The ui bridge test NOTE
about avoiding hex in fixtures is updated — hex stylesheet fixtures are safe
on the current artifact (md5 `858bcb0c…`).

Diagnostics are no longer silent for parse failures: recovery warnings ride
the compile output (and the IR), and hard errors preserve the warnings
observed before them.

## Bug 4 (new, perf) — the recovery path is super-linear in the number of invalid rules

Found while benchmarking adopt/recompile cycles from the ui side (2026-10-12,
same artifact `858bcb0c…`). A stylesheet whose selectors are invalid (e.g.
`.probe-1-0.5123…` — a class token starting with a digit) triggers parser
recovery **per rule**, and compile cost grows super-linearly with the count of
recovered rules. Measured on one component, growing join, 40 rules of
`~45 bytes` each:

| shape | compile at rule 1 | at rule 20 | at rule 40 |
| --- | --- | --- | --- |
| valid, unique class names | 0.13 ms | ~0.18 ms | ~0.26 ms (linear ✓) |
| invalid idents (recovery per rule) | 0.19 ms | ~12 ms | ~21–37 ms |

diagnostics are correct in both shapes (1:1 with the invalid rules); linear
memory stays flat (22–24 pages) — so this is the recovery walk itself
(presumably re-scanning accumulated state per recovery), not a leak. Valid
input never enters this path, which is why the corpus/smoke don't see it.

Repro: compile `n` rules of `.probe-${i}-<random float> { color: … }` joined
into one sheet on a single component; compare against the same shape with
valid unique class names. Suggested corpus case: an `n`-rule recovery sheet
with a compile-time budget; suggested fix direction: whatever state the
recovery walk re-traverses per rule (candidate: the shared writer/table state
the packed-tables commits touched) should reset per compile.

Impact: real-world legacy/generated stylesheets with many invalid rules pay
this silently. The ui never does on valid CSS (its recompiles stay ~0.2 ms).

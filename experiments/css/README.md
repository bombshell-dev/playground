# Bombshell CSS

The CSS pipeline for [Bombshell UI](https://github.com/bombshell-dev/ui): a
full modern-CSS compiler front-end, a selector/cascade runtime, and a
freestanding wasm component that speaks WIT.

## Architecture

```
CSS text ──▶ bombshell-css-compiler ──▶ typed IR (v2, postcard bytes)
              (lexbor C shim: token-level events,
               Rust semantics: nesting expansion,
               condition parsing, canonicalization)
                         │
                         ▼
              bombshell-css-runtime ──▶ computed declarations
              (parcel_selectors matcher,
               cascade + inheritance,
               custom properties / var(),
               media/container/supports eval)
                         │
                         ▼
              bombshell-css-wasm (WIT world `bombshell:css@0.3.0`)
```

- **`bombshell-css-core`** — shared contracts: the versioned compiled-
  stylesheet IR, the flat DOM snapshot (`TreeSnapshot`), the render
  `Environment`, the wire codec, and (behind the default `selectors`
  feature) the `parcel_selectors` selector engine that both the compiler
  and the runtime drive. The IR half stays `serde` + `postcard` and
  `no_std`-capable.
- **`bombshell-css-compiler`** — the front-end. A vendored
  [lexbor](https://github.com/lexbor/lexbor) (Apache-2.0) drives a C shim
  (`c/shim.c`) that runs lexbor's syntax parser with custom callbacks and
  emits a flat event stream of byte spans. Everything semantic happens in
  Rust: nesting expansion per the CSS Nesting spec (`&` → parent
  substitution), typed condition trees parsed from raw preludes
  (`@media`/`@container`/`@supports`), selector validation and specificity
  through the shared `parcel_selectors` parser (so the compiler and the
  runtime matcher can never disagree about what is valid), and canonical
  value serialization (numbers, colors, `light-dark()`, `font-weight`
  keywords). Selectors and declaration values cross the boundary as
  canonical CSS text; conditions cross as typed trees.
- **`bombshell-css-runtime`** — the engine. Selector matching runs on
  `parcel_selectors` (the selector engine lightningcss itself uses) adapted
  to the snapshot model. The cascade implements origin/importance, `@layer`
  ordering, specificity, and source order; inheritance, custom properties,
  `var()` substitution (with fallbacks and cycle detection), and CSS-wide
  keywords (`inherit`, `unset`, `initial`, `revert`) resolve per element.
- **`bombshell-css-wasm`** — the WIT adapter. `compile(css, origin)` returns
  opaque IR bytes plus diagnostics; `prepare(ir)` decodes and parses a
  stylesheet once and returns a handle; `compute(handle, …)` styles one node
  and `compute-tree(handle, nodes, parents, env)` styles the whole flat tree
  in a single pass — the per-frame entry point, with each node's cascade
  running exactly once per frame. `release(handle)` drops a prepared sheet.
  The host's linear-memory contract stays free of Rust/JS object layouts,
  and the module is freestanding — zero imports (the C side gets a tiny
  Rust-backed `malloc` family).
- **`bombshell-css-conformance`** — the corpus: `cases/` fixtures with a
  compile/round-trip runner plus behavior tests that compile cases and
  assert computed results.

## Size and speed

The lexbor front-end replaced lightningcss (MPL-2.0) to cut module weight —
lightningcss was ~94% of the artifact. The size pass on top (vendored-lexbor
trimming, `opt-level = "z"`, nightly `immediate-abort` panics, and the
selector-parsing unification below) roughly halved it again:

| | before (lightningcss) | after (lexbor) | size + speed pass |
| --- | --- | --- | --- |
| full component (wasm-opt -Oz) | 3.31 MB / 780 KB gzip | 471 KB / 177 KB gzip | **214 KB / 87 KB gzip** |
| compile throughput (77 KB corpus, wasm) | ~15.7 MB/s | ~11.4 MB/s | ~15.1 MB/s |
| whole-tree compute (18-node tree, 1151 rules) | — | ~194 µs/node | **~13 µs/node** |

`node demo/bench.mjs` re-measures the shipped artifact.

## The tree ABI

`compute` receives the whole subtree as a flat, document-ordered node list
plus a parent-index vector (`u32::MAX` = root). This recursion-free shape is
WIT-friendly yet complete: structural pseudo-classes (`:nth-child`,
`:first/last/only-child`), sibling combinators (`+`, `~`), and `:has()`
traversal all work off the snapshot. Ancestors are cascaded automatically so
inheritance, custom properties, and container lookups (`container-type`,
`container-name` from computed styles; sizes from node layout) compose.

`compute-tree` is the per-frame entry point: one call styles every node,
each node's cascade runs exactly once, and descendants inherit computed
values (var() substitution happens per level, so inheritance carries
computed — not raw — values). The frame loop allocates nothing that
outlives the call; `demo/smoke.mjs` asserts hundreds of full-tree frames
grow memory by zero bytes. Loaded stylesheets borrow the parsed selectors
from the IR — `Stylesheet::from_ir(&ir, …)` is allocation-free apart from
parsing — and a rule index built from the parsed selectors' rightmost
compounds keeps per-node matching proportional to relevant rules, not to
the whole sheet.

## Build

```sh
cargo test --workspace

# The shipped artifact needs nightly (std is rebuilt with immediate-abort
# panics and panic-location strings disabled) plus Binaryen:
./demo/build.sh
```

`demo/build.sh` runs `cargo +nightly build -Z build-std=std,panic_abort` with
`-Cpanic=immediate-abort -Zlocation-detail=none -Zfmt-debug=none` and then
`wasm-opt -Oz` with the feature flags the module actually uses (bulk-memory,
reference-types, nontrapping-float-to-int, sign-ext, mutable-globals,
multivalue, tail-call — deliberately *not* GC: Binaryen's bottom-type
encoding under `--enable-gc` is not parseable by V8). It then encodes the
optimized module into `wasm.ts` (generated, not hand-maintained) — the same
bundle-friendly scheme the [tty](https://github.com/bombshell-dev/tty) repo
uses: brotli at maximum quality, Z85-encoded into a self-contained
TypeScript module that embeds its own decoder and exports `compiled`, a
ready `WebAssembly.Module`. Hosts import the artifact instead of shipping
and locating a `.wasm` binary, and instantiate it synchronously (the module
is freestanding — zero imports). Verify the encoded artifact by instantiating
it and replaying the demo smoke assertions through it:

```sh
deno run --allow-read --allow-write tasks/verify-bundle.ts
```

A debug build without the size pass:

```sh
cargo build -p bombshell-css-wasm --target wasm32-unknown-unknown --release
```

The vendored C builds with the `cc` crate for both native and wasm32; for
wasm the build is freestanding (stub libc headers under `vendor/stubs`, a
minimal `memcpy` family in the shim, and a Rust-backed `malloc` family in
`alloc_shim.rs`). On macOS an explicit `-isysroot` is probed because
CommandLineTools/Xcode SDK resolution can break.

## Status

Implemented and tested:

- **Parsing/compilation** (lexbor + Rust): full Syntax Level 3/4, nesting
  (including `@nest`, nested group rules, `&` inside functional arguments),
  statement at-rules (`@layer a, b;`), `@keyframes`/opaque at-rule
  preservation, diagnostics with error recovery.
- **Selectors** (parcel_selectors runtime matching): tag/class/ID,
  attribute operators with `i`/`s` flags, descendant/child/next-sibling/
  later-sibling combinators, `:is()`, `:where()`, `:not()` (complex args),
  `:has()` (traversal), `:nth-child(An+B)`, `:nth-child(An+B of S)`,
  `:first/last/only-child`, `:-of-type`, `:root`, `:empty`, `:hover`,
  `:active`, `:focus`, `:focus-visible`, `:focus-within`, `:lang()`,
  `:dir()`, and attribute-derivable state pseudos (`:disabled`, `:checked`,
  `:required`, `:read-only/write`, `:placeholder-shown`, ...).
- **Cascade**: origin + importance ordering, `@layer` (first-appearance
  order, nested paths, unlayered wins), specificity (parcel-compatible,
  computed Rust-side: `:not`/`:is` take the max of their arguments, `:where`
  and `:has` contribute nothing), source order.
- **Values**: canonicalized Rust-side (number minification, named colors to
  shortest-hex, `light-dark()` resolved to its light branch, `font-weight`
  keywords; modern color functions preserved: `oklab`/`oklch`/`lab`/`lch`/
  `color()`/`color-mix()`/relative `rgb()`), custom properties, `var()` with
  fallbacks and cycle detection, CSS-wide keywords.
- **Conditions**: media (range/interval syntax, discrete features,
  `not`/`and`/`or`, OR lists), container queries (named + anonymous,
  `width`/`height`/`inline-size`/`block-size`/`aspect-ratio`/`orientation`,
  container units `cqw`/`cqh`/... in query values), `@supports` with
  compile-time leaf evaluation.

Deliberately not implemented yet (the IR preserves the syntax; the runtime
skips it with the boundary unchanged):

- `:nth-col()`, shadow-DOM selectors (`:host`, `::slotted`, `::part`) —
  parsed but never matched.
- Pseudo-elements (`::before`, `::after`, `::selection`, ...) — parsed but
  never matched; generated content is a terminal-layout question.
- Style queries (`style(color: red)`) and scroll-state queries — parsed,
  preserved, not evaluated.
- Animations/transitions (`@keyframes` is preserved verbatim), `@property`
  registration semantics, initial-value tables for unset properties,
  `@scope` proximity, and container `em` resolution against the container's
  own font-size (currently a 16px base).
- Value validation is partial: structural failures and color-property
  values are checked (colors are single keywords/hashes/functions); other
  property grammars are not validated (lightningcss validated everything —
  a curated per-property grammar table is the eventual replacement).

## Provenance

- [lexbor](https://github.com/lexbor/lexbor) (Apache-2.0) is vendored under
  `crates/css-compiler/vendor/lexbor` and trimmed to the syntax parser:
  only `core/*` memory/string/number primitives, `css/{css,log,parser,rule}.c`,
  and `css/syntax/*` are compiled (the selectors, typed at-rule/property,
  and value layers are dropped — Rust owns those semantics). Local patches
  to that subset: lexbor's log formatting is gutted (message text is never
  read; `parser->status` is the only observable) and the token-error path
  no longer serializes token text.
- `parcel_selectors` and `cssparser` are the same versions lightningcss
  1.0.0-alpha.72 depends on; selector validation and specificity come from
  the same `parcel_selectors` parser the runtime matcher uses.
- Conformance cases are written against the CSSWG specifications (CSS
  Nesting 1, Selectors 4, Media Queries 4, Containment 3, Cascade 5, Color
  4/5); lightningcss upstream fixtures informed several nesting and
  condition shapes in the original spike. This repository's own code is
  MIT.

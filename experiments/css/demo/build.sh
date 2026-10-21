#!/bin/sh
# Build the shipped wasm component. Size-minimal: the nightly toolchain is
# required for the std rebuild (panic_immediate_abort strips panic payloads)
# and for the rustc location-detail/fmt-debug flags that keep panic location
# strings and Debug impls out of linear memory.
set -e

FLAGS="-Zunstable-options -Cpanic=immediate-abort -Zlocation-detail=none -Zfmt-debug=none"

RUSTFLAGS="$FLAGS" cargo +nightly build -p bombshell-css-wasm --target wasm32-unknown-unknown --release \
  -Z build-std=std,panic_abort

# Feature set must match what the module uses: no GC (binaryen's bottom-type
# encoding with GC enabled is not parseable by V8). A second -Oz pass shaves
# the last few hundred bytes.
wasm-opt target/wasm32-unknown-unknown/release/bombshell_css_wasm.wasm \
  -Oz \
  --enable-bulk-memory --enable-reference-types --enable-nontrapping-float-to-int \
  --enable-sign-ext --enable-mutable-globals --enable-multivalue --enable-tail-call \
  --strip-debug --strip-producers \
  -o demo/bombshell_css_wasm.wasm

wasm-opt demo/bombshell_css_wasm.wasm \
  -Oz \
  --enable-bulk-memory --enable-reference-types --enable-nontrapping-float-to-int \
  --enable-sign-ext --enable-mutable-globals --enable-multivalue --enable-tail-call \
  -o demo/bombshell_css_wasm.wasm

stat -f "%z bytes" demo/bombshell_css_wasm.wasm

# Encode the optimized module into the bundle-friendly artifact: a
# self-contained wasm.ts exporting the compiled module (same scheme as the
# tty repo). Needs deno.
deno run --allow-read --allow-write tasks/bundle-wasm.ts

# Demo

A minimal browser demo that drives the full pipeline through the raw WIT
canonical ABI of `bombshell-css-wasm`:

1. compile the editable stylesheet (lexbor front-end → typed IR),
2. decode the IR with a small postcard reader,
3. resolve computed styles for a small tree snapshot
   (container queries, `@media`, nesting, custom properties),
4. display the compiled rules and the computed declarations.

`abi.js` is the interesting part: it implements the component-model
canonical ABI by hand (string/list encoding, the `compiled-sheet` record,
the 56-byte `node` record) plus a postcard reader for IR v2. It follows the
wit-bindgen allocation protocol: host inputs are allocated with
`cabi_realloc` and transfer ownership to the module (never freed
host-side), and the callee-owned return areas are released with the
`cabi_post_*` hooks after reading. The editor drives `compile` per
keystroke, `prepare` once, and `compute-tree` per render — one canonical-ABI
crossing per frame for the whole tree.

Build and run:

```sh
./demo/build.sh              # nightly + build-std + wasm-opt size pass

node demo/smoke.mjs          # ABI smoke test without a browser (checks the
                             # frame loop leaks nothing)
node demo/bench.mjs          # compile-throughput benchmark
python3 -m http.server 8080  # then open http://localhost:8080/demo/
```

The optimized artifact is git-ignored; build it locally as shown above. The
build also encodes it into `wasm.ts` at the repo root — the bundle-friendly
artifact hosts import instead of the binary.

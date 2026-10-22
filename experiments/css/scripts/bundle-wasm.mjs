// Encode a built wasm module into `src/wasm.js`: brotli at maximum quality,
// Z85-encoded into a self-contained module that embeds its own decoder and
// exports `compiled`, a ready `WebAssembly.Module`. Same bundle-friendly
// scheme the tty repo uses for its embedded artifacts.
//
// The optimized freestanding artifact needs nightly (`-Z build-std`,
// immediate-abort panics) plus Binaryen; see the css-compiler workspace
// README in the css repository history for the full recipe:
//
//   cargo +nightly build -Z build-std=std,panic_abort \
//     -p bombshell-css-wasm --target wasm32-unknown-unknown --release
//   wasm-opt -Oz --enable-bulk-memory --enable-reference-types \
//     --enable-nontrapping-float-to-int --enable-sign-ext \
//     --enable-mutable-globals --enable-multivalue --enable-tail-call \
//     -o bombshell_css.wasm target/wasm32-unknown-unknown/release/bombshell_css_wasm.wasm
//
// Usage: node scripts/bundle-wasm.mjs <path-to-module.wasm>

import { brotliCompressSync, constants } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

const Z85 =
	"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";

function encodeZ85(data) {
	let padLen = (4 - (data.length % 4)) % 4;
	let src = data;
	if (padLen > 0) {
		src = new Uint8Array(data.length + padLen);
		src.set(data);
	}
	let out = [];
	for (let i = 0; i < src.length; i += 4) {
		let v = src[i] * 16777216 + src[i + 1] * 65536 + src[i + 2] * 256 + src[i + 3];
		out.push(
			Z85[Math.floor(v / 52200625)],
			Z85[Math.floor(v / 614125) % 85],
			Z85[Math.floor(v / 7225) % 85],
			Z85[Math.floor(v / 85) % 85],
			Z85[v % 85],
		);
	}
	return out.join("");
}

const wasm = readFileSync(process.argv[2]);

const compressed = new Uint8Array(
	brotliCompressSync(wasm, {
		params: {
			[constants.BROTLI_PARAM_QUALITY]: 11,
			[constants.BROTLI_PARAM_SIZE_HINT]: wasm.length,
			[constants.BROTLI_PARAM_LGWIN]: 24,
		},
	}),
);

const z85 = encodeZ85(compressed);

// The decoder receives the pre-padding module length, so the zero bytes the
// Z85 alignment pad contributes never reach WebAssembly.compile.
// Decoding uses division instead of >>> to avoid 32-bit truncation on
// values near 0xFFFFFFFF.
const source = `import{brotliDecompressSync}from"node:zlib";
const Z="0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";
const T=new Uint8Array(128);for(let i=0;i<85;i++)T[Z.charCodeAt(i)]=i;
// the table lookups are non-null for well-formed z85 input; the bounds
// checks below handle a short tail, so the assertions carry no risk
function d(s,n){const b=new Uint8Array(n);let o=0;for(let i=0;i<s.length&&o<n;i+=5){const v=T[s.charCodeAt(i)]*52200625+T[s.charCodeAt(i+1)]*614125+T[s.charCodeAt(i+2)]*7225+T[s.charCodeAt(i+3)]*85+T[s.charCodeAt(i+4)];if(o<n)b[o++]=Math.floor(v/16777216);if(o<n)b[o++]=Math.floor(v/65536)%256;if(o<n)b[o++]=Math.floor(v/256)%256;if(o<n)b[o++]=v%256;}return b;}
const compressed=d(${JSON.stringify(z85)},${wasm.length});
export const compiled=await WebAssembly.compile(new Uint8Array(brotliDecompressSync(compressed)));
`;

writeFileSync(new URL("../src/wasm.js", import.meta.url), source);
console.log(
	`wrote src/wasm.js (${wasm.length} → ${compressed.byteLength} bytes compressed, ${z85.length} bytes z85, ${
		Math.round((z85.length / wasm.length) * 100)
	}%)`,
);

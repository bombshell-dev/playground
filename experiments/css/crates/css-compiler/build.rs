//! Builds the vendored lexbor sources plus the front-end shim.
//!
//! For `wasm32-unknown-unknown` the build is freestanding: stub libc headers
//! under `vendor/stubs` stand in for the missing sysroot and the shim provides
//! minimal memcpy-family implementations. On native targets the system libc is
//! used; on macOS an explicit `-isysroot` works around CLT/Xcode SDK
//! resolution issues.

use std::path::PathBuf;
use std::process::Command;

fn main() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let manifest = PathBuf::from(manifest);
    let vendor = manifest.join("vendor");
    let lexbor = vendor.join("lexbor/lexbor");
    let target = std::env::var("TARGET").unwrap();
    let freestanding = target == "wasm32-unknown-unknown";

    let mut build = cc::Build::new();

    build
        .opt_level_str("z")
        .flag("-fno-exceptions")
        .include(vendor.join("lexbor"))
        .file(manifest.join("c/shim.c"))
        .warnings(false);

    if freestanding {
        build
            .flag("--target=wasm32-unknown-unknown")
            .flag("-ffreestanding")
            .flag("-mbulk-memory")
            .define("LBX_FREESTANDING", None)
            .include(vendor.join("stubs"));
    }

    if target.contains("darwin") {
        if let Some(sdk) = macos_sdk() {
            build.flag("-isysroot").flag(&sdk);
        }
    }

    // Only the modules the shim actually reaches: the syntax tokenizer/parser
    // and the core memory/string/number primitives they sit on. Selector
    // validation and specificity are parcel_selectors' job on the Rust side
    // (one parser shared with the runtime matcher), and lexbor's typed
    // at-rule/property/value layers, serializers, and search structures
    // (avl/bst/hash/shs) are never touched by the event-stream shim.
    let keep = [
        // core primitives
        "core/array.c",
        "core/array_obj.c",
        "core/bst.c",
        "core/diyfp.c",
        "core/dobject.c",
        "core/mem.c",
        "core/mraw.c",
        "core/str.c",
        "core/strtod.c",
        // css front-end used by the shim
        "css/css.c",
        "css/log.c",
        "css/parser.c",
        "css/rule.c",
        "css/syntax/parser.c",
        "css/syntax/syntax.c",
        "css/syntax/state.c",
        "css/syntax/token.c",
        "css/syntax/tokenizer.c",
        "css/syntax/tokenizer/error.c",
        "ports/posix/lexbor/core/memory.c",
    ];

    for rel in keep {
        build.file(lexbor.join(rel));
    }

    build.compile("lexbor_css");

    println!("cargo:rerun-if-changed=c/shim.c");
    println!("cargo:rerun-if-changed=vendor");
}

fn macos_sdk() -> Option<String> {
    if let Ok(output) = Command::new("xcrun").arg("--show-sdk-path").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && std::path::Path::new(&path).join("usr/include").exists() {
                return Some(path);
            }
        }
    }

    // CLT/Xcode SDK resolution can break out from under us; probe known
    // locations and pick the newest existing SDK.
    for root in [
        "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs",
        "/Library/Developer/CommandLineTools/SDKs",
    ] {
        let mut candidates: Vec<String> = std::fs::read_dir(root)
            .ok()?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with("MacOSX") && name.ends_with(".sdk"))
                    .unwrap_or(false)
            })
            .map(|path| path.to_string_lossy().into_owned())
            .collect();
        candidates.sort();
        if let Some(path) = candidates.pop() {
            if std::path::Path::new(&path).join("usr/include").exists() {
                return Some(path);
            }
        }
    }

    None
}

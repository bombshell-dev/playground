//! Conformance corpus runner.
//!
//! Every `cases/**/*.css` must either compile cleanly or be marked with a
//! sibling `.error` file naming the expected diagnostic code. The compiled
//! IR must round-trip through the wire codec. Semantic behavior (matching,
//! cascade, conditions) is covered by `tests/behavior.rs`.

use std::fs;
use std::path::{Path, PathBuf};

use bombshell_css_compiler::{CompileOptions, compile};
use bombshell_css_core::{Origin, decode_ir, encode_ir};

fn case_dirs() -> Vec<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("cases");
    let mut dirs = vec![root.clone()];
    for entry in fs::read_dir(&root).expect("cases directory") {
        let path = entry.expect("entry").path();
        if path.is_dir() {
            dirs.push(path);
        }
    }
    dirs
}

fn case_files() -> Vec<PathBuf> {
    let mut files = Vec::new();
    for dir in case_dirs() {
        for entry in fs::read_dir(&dir).expect("readable") {
            let path = entry.expect("entry").path();
            if path.extension().and_then(|e| e.to_str()) == Some("css") {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

#[test]
fn corpus_compiles_and_round_trips() {
    let files = case_files();
    assert!(
        files.len() >= 12,
        "expected a non-trivial corpus, found {files:?}"
    );
    for path in &files {
        let css = fs::read_to_string(path).expect("readable case");
        let error_marker = path.with_extension("error");
        let options = CompileOptions {
            error_recovery: false,
            ..CompileOptions::default()
        };
        let output = compile(&css, Origin::Author, options);

        if error_marker.exists() {
            let expected = fs::read_to_string(&error_marker)
                .expect("readable marker")
                .trim()
                .to_string();
            assert!(
                output.sheet.is_none(),
                "case {} unexpectedly compiled; expected error {expected}",
                path.display()
            );
            assert!(
                output.diagnostics.iter().any(|d| d.code == expected),
                "case {} missing diagnostic code {expected}: {:?}",
                path.display(),
                output.diagnostics
            );
            continue;
        }

        assert!(
            !output
                .diagnostics
                .iter()
                .any(|d| d.severity == bombshell_css_core::Severity::Error),
            "case {} produced errors: {:?}",
            path.display(),
            output.diagnostics
        );
        let sheet = output.sheet.expect("sheet present");
        assert_eq!(sheet.version, bombshell_css_core::IR_VERSION);
        let bytes = encode_ir(&sheet);
        let decoded = decode_ir(&bytes).expect("round trip");
        assert_eq!(decoded, sheet, "case {} IR mismatch", path.display());
        assert!(
            !sheet.rules.is_empty(),
            "case {} produced no rules",
            path.display()
        );
    }
}

#[test]
fn nesting_expands_against_the_spec() {
    let css = read_case("nesting/01-basic.css");
    let sheet = compile_strict(&css);
    let selectors: Vec<&str> = sheet.rules.iter().map(|r| r.selector.as_str()).collect();
    // Implicit nesting (`.body` without `&`) is a descendant relationship.
    assert_eq!(selectors, vec![".card", ".card>.title", ".card .body"]);
}

#[test]
fn deep_nesting_expands_every_ampersand() {
    let css = read_case("nesting/02-deep-nesting.css");
    let sheet = compile_strict(&css);
    let selectors: Vec<&str> = sheet.rules.iter().map(|r| r.selector.as_str()).collect();
    // Only the innermost rule carries declarations; ancestors without
    // declarations collapse. `:not(&)` substitutes the fully expanded parent.
    assert_eq!(selectors, vec![":not(.a .b.c)"]);
}

#[test]
fn nested_conditions_keep_the_style_context() {
    let css = read_case("nesting/03-nested-conditions.css");
    let sheet = compile_strict(&css);
    assert_eq!(sheet.rules.len(), 3);
    assert_eq!(sheet.rules[0].selector, ".panel");
    assert!(sheet.rules[0].media.is_empty());
    assert_eq!(sheet.rules[1].selector, ".panel .item");
    assert_eq!(sheet.rules[1].media.len(), 1);
    assert_eq!(sheet.rules[2].selector, ".panel .item");
    assert_eq!(sheet.rules[2].containers.len(), 1);
}

#[test]
fn level4_selectors_are_preserved() {
    let css = read_case("selectors/01-level4.css");
    let sheet = compile_strict(&css);
    let selectors: Vec<&str> = sheet.rules.iter().map(|r| r.selector.as_str()).collect();
    assert_eq!(
        selectors,
        vec![
            ":is(.a,.b)>.c",
            ":where(#x,.y) .z",
            ".item:not(.skip):not(.list>*)",
            ".row:has(>.col)",
            ".item:nth-child(odd of .tagged)",
            ".item:nth-child(-n+3)",
            "p:has(+h2)",
        ]
    );
}

#[test]
fn conditions_are_typed_in_the_ir() {
    let css = read_case("conditions/01-media.css");
    let sheet = compile_strict(&css);
    assert_eq!(sheet.rules.len(), 5);
    // The interval form canonicalizes.
    match &sheet.rules[0].media[0] {
        bombshell_css_core::MediaCondition::Feature(feature) => {
            assert_eq!(feature.name, "width");
            assert!(matches!(
                feature.kind,
                bombshell_css_core::FeatureKind::Interval { .. }
            ));
        }
        other => panic!("unexpected media condition {other:?}"),
    }
    // The comma list becomes an OR branch.
    match &sheet.rules[4].media[0] {
        bombshell_css_core::MediaCondition::Or(branches) => assert_eq!(branches.len(), 2),
        other => panic!("expected OR list, got {other:?}"),
    }
}

#[test]
fn layers_are_registered_in_first_appearance_order() {
    let css = read_case("cascade/01-layers.css");
    let sheet = compile_strict(&css);
    assert_eq!(
        sheet.layer_order,
        vec![
            vec!["a".to_string()],
            vec!["b".to_string()],
            vec!["b".to_string(), "c".to_string()],
        ]
    );
    assert_eq!(
        sheet.rules[0].layer.as_deref(),
        Some(["a".to_string()].as_slice())
    );
    assert_eq!(
        sheet.rules[1].layer.as_deref(),
        Some(["b".to_string(), "c".to_string()].as_slice())
    );
    assert_eq!(sheet.rules[2].layer, None);
}

#[test]
fn important_is_tracked_per_declaration() {
    let css = read_case("cascade/02-important.css");
    let sheet = compile_strict(&css);
    assert!(sheet.rules[0].declarations[0].important);
    assert!(!sheet.rules[1].declarations[0].important);
}

fn read_case(rel: &str) -> String {
    fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("cases")
            .join(rel),
    )
    .expect("case file")
}

fn compile_strict(css: &str) -> bombshell_css_core::CompiledStylesheet {
    let output = compile(css, Origin::Author, CompileOptions::default());
    assert!(output.diagnostics.is_empty(), "{:?}", output.diagnostics);
    output.sheet.expect("sheet")
}

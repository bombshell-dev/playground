use bombshell_css_compiler::compile;
use bombshell_css_core::{FeatureKind, FeatureValue, IR_VERSION, Origin, decode_ir, encode_ir};

fn compile_ok(css: &str) -> bombshell_css_core::CompiledStylesheet {
    let out = compile(css, Origin::Author, Default::default());
    assert!(
        out.diagnostics.is_empty(),
        "unexpected diagnostics: {:?}",
        out.diagnostics
    );
    let sheet = out.sheet.expect("sheet should compile");
    assert_eq!(sheet.version, IR_VERSION);
    sheet
}

#[test]
fn compiles_nesting_expansion() {
    let sheet = compile_ok(
        r"
        .card {
          color: oklch(70% 0.2 40);

          & > .title {
            font-weight: bold;

            &:hover { text-decoration: underline; }
          }
        }
        ",
    );
    let selectors: Vec<&str> = sheet.rules.iter().map(|r| r.selector.as_str()).collect();
    assert_eq!(
        selectors,
        vec![".card", ".card>.title", ".card>.title:hover"]
    );
    assert_eq!(sheet.rules[0].declarations[0].name, "color");
    assert_eq!(sheet.rules[0].declarations[0].value, "oklch(70% .2 40)");
}

#[test]
fn compiles_conditions_and_layers() {
    let sheet = compile_ok(
        r"
        @layer base;
        @layer base.type { .a { color: red } }
        @media (min-width: 24em) {
          @container panel (inline-size > 45em) {
            @supports (color: oklch(70% 0.2 40)) {
              .b { color: blue }
            }
          }
        }
        ",
    );
    assert_eq!(sheet.layer_order, vec![vec!["base"], vec!["base", "type"]]);
    assert_eq!(sheet.rules.len(), 2);
    assert_eq!(
        sheet.rules[0].layer.as_deref(),
        Some(["base".to_string(), "type".to_string()].as_slice())
    );
    let rule = &sheet.rules[1];
    assert_eq!(rule.layer, None);
    assert_eq!(rule.media.len(), 1);
    assert_eq!(rule.containers.len(), 1);
    assert_eq!(rule.containers[0].name.as_deref(), Some("panel"));
    assert_eq!(rule.supports.len(), 1);

    // min-width: 24em canonicalizes to width >= 384px (16px base em).
    let bombshell_css_core::MediaCondition::Feature(feature) = &rule.media[0] else {
        panic!("expected media feature");
    };
    assert_eq!(feature.name, "width");
    match &feature.kind {
        FeatureKind::Range {
            cmp: bombshell_css_core::Compare::GreaterThanEqual,
            value: FeatureValue::RelativeLength { value: 24.0, unit },
        } => assert_eq!(unit, "em"),
        other => panic!("unexpected feature kind: {other:?}"),
    }
}

#[test]
fn compiles_keyframes_and_preserves_opaque_rules() {
    let sheet = compile_ok(
        r"
        @keyframes pulse { from { opacity: 1 } to { opacity: 0 } }
        @font-face { font-family: X; src: url(x.woff2) }
        @property --brand { syntax: '<color>'; initial-value: red; inherits: true }
        ",
    );
    assert_eq!(sheet.keyframes.len(), 1);
    assert_eq!(sheet.keyframes[0].name, "pulse");
    assert!(sheet.keyframes[0].body.starts_with("@keyframes pulse"));
    assert_eq!(sheet.opaque.len(), 2);
    assert!(sheet.opaque[0].text.starts_with("@font-face"));
    assert!(sheet.opaque[1].text.starts_with("@property"));
}

#[test]
fn reports_parse_errors() {
    let out = compile(
        ".a { color: this is not a color !! }",
        Origin::Author,
        bombshell_css_compiler::CompileOptions {
            error_recovery: false,
            ..Default::default()
        },
    );
    assert!(out.sheet.is_none());
    assert!(!out.diagnostics.is_empty());
    assert_eq!(
        out.diagnostics[0].severity,
        bombshell_css_core::Severity::Error
    );
}

#[test]
fn ir_round_trips_through_compiler() {
    let sheet = compile_ok(".a { color: red; &:hover { color: blue } }");
    let bytes = encode_ir(&sheet);
    let decoded = decode_ir(&bytes).unwrap();
    assert_eq!(decoded, sheet);
    assert_eq!(decoded.rules.len(), 2);
    assert_eq!(decoded.rules[1].selector, ".a:hover");
}

#[test]
fn preserves_light_dark_for_the_runtime() {
    // The compiler no longer folds to the light branch: both branches are
    // validated and canonicalized, and resolution happens against the
    // environment's color scheme at computed-value time.
    let sheet = compile_ok(".card { color: light-dark(white, black) }");
    assert_eq!(sheet.rules[0].declarations[0].value, "light-dark(#fff, #000)");
}

#[test]
fn canonicalizes_light_dark_branches_independently() {
    // Case-insensitive function name; each branch canonicalizes like a
    // standalone color value.
    let sheet = compile_ok(".card { border-color: LIGHT-DARK( #ffffff , yellow ) }");
    assert_eq!(
        sheet.rules[0].declarations[0].value,
        "light-dark(#ffffff, #ff0)"
    );
}

#[test]
fn rejects_malformed_light_dark() {
    for css in [
        ".card { color: light-dark(#fff) }",
        ".card { color: light-dark(#fff, #000, #888) }",
        ".card { color: light-dark(#fff, nope) }",
    ] {
        let out = compile(css, Origin::Author, Default::default());
        let sheet = out.sheet.expect("recovered sheet");
        assert!(
            out.diagnostics
                .iter()
                .any(|d| d.message.contains("invalid color value")),
            "missing diagnostic for {css}: {:?}",
            out.diagnostics
        );
        assert!(
            sheet.rules.iter().all(|rule| rule.declarations.is_empty()),
            "declaration survived for {css}"
        );
    }
}

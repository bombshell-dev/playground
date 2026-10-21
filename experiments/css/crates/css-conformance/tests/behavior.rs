//! Behavior conformance: compile corpus cases and resolve computed styles
//! against tree snapshots, asserting the cascade semantics the corpus pins.

use std::fs;
use std::path::Path;

use bombshell_css_compiler::{CompileOptions, compile};
use bombshell_css_core::{ColorScheme, Environment, NO_PARENT, NodeSnapshot, Origin, TreeSnapshot};
use bombshell_css_runtime::{Stylesheet, compute};

fn read_case(rel: &str) -> String {
    fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("cases")
            .join(rel),
    )
    .expect("case file")
}

/// An owned compiled case; [`Case::sheet`] borrows the parsed stylesheet
/// from the IR it keeps alive.
struct Case {
    ir: bombshell_css_core::CompiledStylesheet,
}

impl Case {
    fn sheet(&self) -> Stylesheet<'_> {
        Stylesheet::from_ir(&self.ir, 0)
    }
}

fn load(css: &str) -> Case {
    let output = compile(css, Origin::Author, CompileOptions::default());
    assert!(
        !output
            .diagnostics
            .iter()
            .any(|d| d.severity == bombshell_css_core::Severity::Error),
        "{:?}",
        output.diagnostics
    );
    Case {
        ir: output.sheet.expect("sheet"),
    }
}

fn tree(nodes: Vec<NodeSnapshot>, parents: Vec<u32>) -> TreeSnapshot {
    TreeSnapshot { nodes, parents }
}

fn classed(tag: &str, classes: &[&str]) -> NodeSnapshot {
    NodeSnapshot {
        tag: tag.to_string(),
        classes: classes.iter().map(|c| c.to_string()).collect(),
        ..Default::default()
    }
}

fn get<'a>(style: &'a bombshell_css_runtime::ComputedStyle, name: &str) -> &'a str {
    style
        .get(name)
        .unwrap_or_else(|| panic!("missing {name}: {:?}", style.declarations))
}

#[test]
fn nesting_case_styles_the_tree() {
    let sheet = load(&read_case("nesting/01-basic.css"));
    let sheet = sheet.sheet();
    let t = tree(
        vec![
            classed("card", &["card"]),
            classed("title", &["title"]),
            classed("body", &["body"]),
        ],
        vec![NO_PARENT, 0, 0],
    );
    let env = Environment::default();
    let s = compute(std::slice::from_ref(&sheet), &t, 1, &env).unwrap();
    assert_eq!(get(&s, "font-weight"), "700");
    // `color` inherits from .card; `.card .body` does not apply to the title.
    assert_eq!(get(&s, "color"), "oklch(70% .2 40)");
    let s = compute(std::slice::from_ref(&sheet), &t, 2, &env).unwrap();
    // lightningcss canonicalizes the static color-mix() to a resolved oklab.
    let color = get(&s, "color");
    assert!(
        color.starts_with("oklab(") || color.starts_with("color-mix("),
        "unexpected color {color}"
    );
    assert_ne!(color, "oklch(70% .2 40)");
}

#[test]
fn level4_selectors_match() {
    let sheet = load(&read_case("selectors/01-level4.css"));
    let sheet = sheet.sheet();
    let t = tree(
        vec![
            classed("row", &["row"]),
            classed("col", &["col"]),
            classed("item", &["item", "tagged"]),
            classed("item", &["item"]),
        ],
        vec![NO_PARENT, 0, 0, 0],
    );
    let env = Environment::default();
    // .row:has(> .col) matches the row.
    let s = compute(std::slice::from_ref(&sheet), &t, 0, &env).unwrap();
    assert_eq!(get(&s, "outline"), "1px");
    // nth-child(odd of .tagged): node 2 is the 1st tagged child → matches.
    let s = compute(std::slice::from_ref(&sheet), &t, 2, &env).unwrap();
    assert_eq!(get(&s, "color"), "#ff0");
    // node 3 is the 3rd child → nth-child(-n+3) applies (blue outranks it on
    // `color` specificity, so the corpus rule uses a distinct property).
    let s = compute(std::slice::from_ref(&sheet), &t, 3, &env).unwrap();
    assert_eq!(get(&s, "text-indent"), "4px");
}

#[test]
fn media_ranges_and_or_lists() {
    let sheet = load(&read_case("conditions/01-media.css"));
    let sheet = sheet.sheet();
    let t = tree(vec![classed("a", &["a"])], vec![NO_PARENT]);
    let env = Environment {
        viewport_width: Some(600.0),
        viewport_height: Some(300.0),
        ..Default::default()
    };
    // The corpus stack: interval red, not-hover orange, and min-width purple
    // all match at 600px; later source order wins.
    assert_eq!(
        get(
            &compute(std::slice::from_ref(&sheet), &t, 0, &env).unwrap(),
            "color"
        ),
        "purple"
    );

    // Interval semantics in isolation.
    let interval = load("@media (400px <= width <= 800px) { .a { color: red } }");
    let interval = interval.sheet();
    assert_eq!(
        get(
            &compute(std::slice::from_ref(&interval), &t, 0, &env).unwrap(),
            "color"
        ),
        "red"
    );
    let small = Environment {
        viewport_width: Some(300.0),
        ..Default::default()
    };
    assert!(
        compute(std::slice::from_ref(&interval), &t, 0, &small)
            .unwrap()
            .get("color")
            .is_none()
    );
    let edge = Environment {
        viewport_width: Some(800.0),
        ..Default::default()
    };
    assert_eq!(
        get(&compute(&[interval], &t, 0, &edge).unwrap(), "color"),
        "red"
    );

    // The OR list matches on max-height 10em (160px) alone.
    let small_height = Environment {
        viewport_width: Some(300.0),
        viewport_height: Some(96.0),
        ..Default::default()
    };
    assert_eq!(
        get(
            &compute(std::slice::from_ref(&sheet), &t, 0, &small_height).unwrap(),
            "color"
        ),
        "purple"
    );
}

#[test]
fn dark_scheme_reaches_the_runtime() {
    let sheet = load(&read_case("conditions/01-media.css"));
    let sheet = sheet.sheet();
    let t = tree(vec![classed("a", &["a"])], vec![NO_PARENT]);
    let env = Environment {
        color_scheme: ColorScheme::Dark,
        ..Default::default()
    };
    // Dark-scheme green matches, but `screen and (not (hover))` also matches
    // and appears later in source order.
    assert_eq!(
        get(
            &compute(std::slice::from_ref(&sheet), &t, 0, &env).unwrap(),
            "color"
        ),
        "orange"
    );

    // Dark scheme in isolation.
    let dark = load("@media (prefers-color-scheme: dark) { .a { color: green } }");
    let dark = dark.sheet();
    assert_eq!(
        get(
            &compute(std::slice::from_ref(&dark), &t, 0, &env).unwrap(),
            "color"
        ),
        "green"
    );
}

#[test]
fn container_corpus_case() {
    let sheet = load(&read_case("conditions/02-container.css"));
    let sheet = sheet.sheet();
    let t = tree(
        vec![
            {
                let mut n = classed("panel", &["panel"]);
                n.width = Some(800.0);
                n.height = Some(200.0);
                n
            },
            classed("a", &["a"]),
        ],
        vec![NO_PARENT, 0],
    );
    let env = Environment::default();
    let s = compute(std::slice::from_ref(&sheet), &t, 1, &env).unwrap();
    // inline-size 800 > 45em (720px) → red; width 800 > 200 → the anonymous
    // container query would win too but it targets `(width < 200px)` → no.
    assert_eq!(get(&s, "color"), "red");
}

#[test]
fn var_case_resolves_through_the_tree() {
    let sheet = load(&read_case("values/01-var.css"));
    let sheet = sheet.sheet();
    let t = tree(
        vec![
            classed("root", &["root"]),
            classed("a", &["a"]),
            classed("b", &["b"]),
            classed("c", &["c"]),
        ],
        vec![NO_PARENT, 0, 0, 0],
    );
    let env = Environment::default();
    let s = compute(std::slice::from_ref(&sheet), &t, 1, &env).unwrap();
    assert_eq!(get(&s, "color"), "oklch(70% .2 40)");
    assert_eq!(get(&s, "margin"), "8px");
    let s = compute(std::slice::from_ref(&sheet), &t, 2, &env).unwrap();
    assert_eq!(get(&s, "padding"), "2px");
    let s = compute(std::slice::from_ref(&sheet), &t, 3, &env).unwrap();
    assert_eq!(get(&s, "color"), "oklch(70% .2 40)");
}

#[test]
fn layer_order_matches_first_appearance() {
    let sheet = load(&read_case("cascade/01-layers.css"));
    let sheet = sheet.sheet();
    let t = tree(vec![classed("x", &["x"])], vec![NO_PARENT]);
    let env = Environment::default();
    // Unlayered rule beats both layered rules.
    assert_eq!(
        get(
            &compute(std::slice::from_ref(&sheet), &t, 0, &env).unwrap(),
            "color"
        ),
        "#00f"
    );
}

#[test]
fn important_beats_source_order() {
    let sheet = load(&read_case("cascade/02-important.css"));
    let sheet = sheet.sheet();
    let t = tree(vec![classed("x", &["x"])], vec![NO_PARENT]);
    let env = Environment::default();
    assert_eq!(
        get(
            &compute(std::slice::from_ref(&sheet), &t, 0, &env).unwrap(),
            "color"
        ),
        "red"
    );
}

#[test]
fn hex_colors_reach_computed_styles() {
    let sheet = load(&read_case("colors/02-hex.css"));
    let sheet = sheet.sheet();
    let t = tree(
        vec![classed("x", &["a"]), classed("y", &["f"])],
        vec![NO_PARENT, NO_PARENT],
    );
    let env = Environment::default();
    // 3-digit hex on `color`…
    let a = compute(std::slice::from_ref(&sheet), &t, 0, &env).unwrap();
    assert_eq!(get(&a, "color"), "#fff");
    // …and on `border-color`.
    let f = compute(std::slice::from_ref(&sheet), &t, 1, &env).unwrap();
    assert_eq!(get(&f, "border-color"), "#333");
}

#[test]
fn single_line_rules_reach_computed_styles() {
    let sheet = load(&read_case("values/02-single-line.css"));
    let sheet = sheet.sheet();
    let t = tree(
        vec![classed("card", &["card", "x"]), classed("y", &["y"])],
        vec![NO_PARENT, 0],
    );
    let env = Environment::default();
    // Both declarations of the single-line rule survive.
    let s = compute(std::slice::from_ref(&sheet), &t, 0, &env).unwrap();
    assert_eq!(get(&s, "color"), "#fff");
    assert_eq!(get(&s, "padding"), "4px");
    // The nested rule opened and closed on the same line as its parent.
    // (`blue` canonicalizes to `#00f`: equal-length ties go to hex.)
    let s = compute(std::slice::from_ref(&sheet), &t, 1, &env).unwrap();
    assert_eq!(get(&s, "color"), "#00f");
}

/// The wasm adapter drives compile → prepare → compute-tree → compile /
/// prepare-again inside one component instance; hosts must see live results
/// at every step. This pins the library-level property that makes that
/// sequence safe: the compiler and the stylesheet loader carry no state
/// across calls. (The component-level sequence is asserted in
/// `demo/smoke.mjs` — an apparent cross-call poison there was traced to a
/// host misreading the `option<>` discriminant over canonical-ABI padding,
/// not to engine state.)
#[test]
fn compile_and_prepare_survive_compute_tree() {
    use bombshell_css_core::{decode_ir, encode_ir};

    let env = Environment::default();
    let first = load(&read_case("colors/02-hex.css"));
    let sheet = first.sheet();
    let t = tree(
        vec![classed("x", &["a"]), classed("y", &["f"])],
        vec![NO_PARENT, NO_PARENT],
    );

    bombshell_css_runtime::cascade::compute_tree(std::slice::from_ref(&sheet), &t, &env, &[]);

    // A later compile walks the same pipeline: identical source, identical IR.
    let second = load(&read_case("colors/02-hex.css"));
    assert_eq!(encode_ir(&first.ir), encode_ir(&second.ir));

    // A later prepare of already-prepared IR bytes still decodes, loads,
    // and computes.
    let decoded = decode_ir(&encode_ir(&first.ir)).expect("re-encoded IR decodes");
    let reloaded = Stylesheet::from_ir(&decoded, 0);
    let s = compute(std::slice::from_ref(&reloaded), &t, 0, &env).unwrap();
    assert_eq!(get(&s, "color"), "#fff");
    let f = compute(std::slice::from_ref(&reloaded), &t, 1, &env).unwrap();
    assert_eq!(get(&f, "border-color"), "#333");
}

//! End-to-end runtime tests: compile CSS, load the IR, and resolve computed
//! styles against tree snapshots.

use bombshell_css_compiler::compile;
use bombshell_css_core::{Environment, NO_PARENT, NodeSnapshot, Origin, TreeSnapshot};
use bombshell_css_runtime::{Stylesheet, compute};

fn node(tag: &str) -> NodeSnapshot {
    NodeSnapshot {
        tag: tag.to_string(),
        ..Default::default()
    }
}

fn tree(nodes: Vec<NodeSnapshot>, parents: Vec<u32>) -> TreeSnapshot {
    TreeSnapshot { nodes, parents }
}

/// An owned compiled case; [`Case::sheet`] borrows the parsed stylesheet
/// from the IR it keeps alive.
struct Case {
    ir: bombshell_css_core::CompiledStylesheet,
    index: usize,
}

impl Case {
    fn sheet(&self) -> Stylesheet<'_> {
        Stylesheet::from_ir(&self.ir, self.index)
    }
}

fn stylesheet(css: &str) -> Case {
    let out = compile(css, Origin::Author, Default::default());
    assert!(out.diagnostics.is_empty(), "{:?}", out.diagnostics);
    Case {
        ir: out.sheet.expect("sheet"),
        index: 0,
    }
}

fn get<'a>(style: &'a bombshell_css_runtime::ComputedStyle, name: &str) -> &'a str {
    style
        .get(name)
        .unwrap_or_else(|| panic!("missing {name}: {:?}", style.declarations))
}

#[test]
fn inline_styles_cascade_above_selectors() {
    // All cases bind first: the invariant `SelectorList` borrow unifies IR
    // lifetimes across the sheets of a single `compute` call, so every
    // `Case` must outlive every `Stylesheet`.
    let case = stylesheet(".card { color: #fff; background: black }");
    let important_case = stylesheet(".card { color: red !important }");
    let other_case = stylesheet(".other { color: red !important }");
    let sheet = case.sheet();
    let important = important_case.sheet();
    let other = other_case.sheet();
    let env = Environment::default();

    // Inline-normal beats every author stylesheet declaration.
    let mut n = node("card");
    n.classes = vec!["card".into()];
    n.style = Some("color: blue; border: none".into());
    let t = tree(vec![n], vec![NO_PARENT]);
    let s = compute(std::slice::from_ref(&&sheet), &t, 0, &env).unwrap();
    assert_eq!(get(&s, "color"), "blue");
    assert_eq!(get(&s, "background"), "black");
    assert_eq!(get(&s, "border"), "none");

    // Author `!important` beats inline-normal…
    let s = compute(&[&sheet, &important], &t, 0, &env).unwrap();
    assert_eq!(get(&s, "color"), "red");
    // …even when the important rule is in an earlier sheet.
    let s = compute(&[&important, &sheet], &t, 0, &env).unwrap();
    assert_eq!(get(&s, "color"), "red");

    // …and an `!important` in a rule that does NOT match the node must not
    // shield the property: the inline style wins.
    let s = compute(&[&other, &sheet], &t, 0, &env).unwrap();
    assert_eq!(get(&s, "color"), "blue");

    // Inline `!important` beats author stylesheet `!important`.
    let mut n_imp = node("card");
    n_imp.classes = vec!["card".into()];
    n_imp.style = Some("color: blue !important".into());
    let t_imp = tree(vec![n_imp], vec![NO_PARENT]);
    let s = compute(&[&sheet, &important], &t_imp, 0, &env).unwrap();
    assert_eq!(get(&s, "color"), "blue");
}

#[test]
fn inline_styles_participate_in_inheritance() {
    // Inline declarations are part of the node's declared values BEFORE
    // var() substitution and inheritance, so descendants inherit the
    // inline-overridden computed values.
    let case = stylesheet(".child { color: var(--brand) }");
    let sheet = case.sheet();
    let env = Environment::default();
    let mut parent = node("root");
    parent.style = Some("--brand: red".into());
    let mut child = node("child");
    child.classes = vec!["child".into()];
    let t = tree(vec![parent, child], vec![NO_PARENT, 0]);
    let s = compute(std::slice::from_ref(&&sheet), &t, 1, &env).unwrap();
    assert_eq!(get(&s, "color"), "red");
}

#[test]
fn inline_styles_reject_malformed_declarations() {
    // url() with a data URI keeps its colons and semicolons intact; junk
    // parts are dropped instead of poisoning the cascade.
    let case = stylesheet(".card { color: #fff }");
    let sheet = case.sheet();
    let env = Environment::default();
    let mut n = node("card");
    n.classes = vec!["card".into()];
    n.style = Some("background: url(data:image/png;base64,AAA); ::bad; color".into());
    let t = tree(vec![n], vec![NO_PARENT]);
    let s = compute(std::slice::from_ref(&&sheet), &t, 0, &env).unwrap();
    assert_eq!(get(&s, "color"), "#fff");
    assert_eq!(
        get(&s, "background"),
        "url(data:image/png;base64,AAA)"
    );
}

#[test]
fn matches_selectors() {
    let css = r"
        box { color: red }
        .panel { color: green }
        #main { color: blue }
        .a.b { color: yellow }
        [disabled] { opacity: 0.5 }
        [role=tab] { text-transform: uppercase }
        [data-x^='pre'] { text-decoration: underline }
        ";
    let sheet = stylesheet(css);
    let sheet = sheet.sheet();
    let t = tree(
        vec![
            node("box"),
            {
                let mut n = node("div");
                n.classes = vec!["panel".into(), "a".into(), "b".into()];
                n.attributes = vec![
                    ("disabled".into(), "".into()),
                    ("role".into(), "tab".into()),
                    ("data-x".into(), "prefix-1".into()),
                ];
                n
            },
            {
                let mut n = node("span");
                n.id = Some("main".into());
                n
            },
        ],
        vec![NO_PARENT, NO_PARENT, NO_PARENT],
    );
    let env = Environment::default();

    assert_eq!(
        get(
            &compute(std::slice::from_ref(&&sheet), &t, 0, &env).unwrap(),
            "color"
        ),
        "red"
    );
    // .a.b wins over .panel (higher specificity).
    assert_eq!(
        get(
            &compute(std::slice::from_ref(&&sheet), &t, 1, &env).unwrap(),
            "color"
        ),
        "#ff0"
    );
    assert_eq!(
        get(
            &compute(std::slice::from_ref(&&sheet), &t, 1, &env).unwrap(),
            "opacity"
        ),
        ".5"
    );
    assert_eq!(
        get(
            &compute(std::slice::from_ref(&&sheet), &t, 1, &env).unwrap(),
            "text-transform"
        ),
        "uppercase"
    );
    // [data-x^='pre'] also matched.
    assert_eq!(
        get(
            &compute(std::slice::from_ref(&&sheet), &t, 1, &env).unwrap(),
            "text-decoration"
        ),
        "underline"
    );
    assert_eq!(
        get(
            &compute(std::slice::from_ref(&&sheet), &t, 2, &env).unwrap(),
            "color"
        ),
        "#00f"
    );
}

#[test]
fn matches_combinators_and_structural_pseudos() {
    let css = r"
        .list > .item { color: red }
        .root .item { color: green }
        .item:first-child { color: blue }
        .item:last-child { color: yellow }
        .item + .item { font-weight: bold }
        .item:nth-child(2n) { opacity: 0.5 }
        .item:only-child { visibility: hidden }
        .root:has(.special) .item { text-decoration: line-through }
        .item:not(.skip) { cursor: pointer }
        .wrap:is(.a, .b) .item { text-align: center }
        ";
    let sheet = stylesheet(css);
    let sheet = sheet.sheet();
    let t = tree(
        vec![
            {
                let mut n = node("root");
                n.classes = vec!["root".into()];
                n
            }, // 0
            {
                let mut n = node("wrap");
                n.classes = vec!["wrap".into(), "a".into()];
                n
            }, // 1
            {
                let mut n = node("list");
                n.classes = vec!["list".into()];
                n
            }, // 2
            {
                let mut n = node("item");
                n.classes = vec!["item".into()];
                n
            }, // 3
            {
                let mut n = node("item");
                n.classes = vec!["item".into()];
                n
            }, // 4
            {
                let mut n = node("item");
                n.classes = vec!["item".into(), "special".into()];
                n
            }, // 5
        ],
        vec![NO_PARENT, 0, 1, 2, 2, 2],
    );
    let env = Environment::default();

    // item 3: first-child; ancestor `.root:has(.special)` styles all items
    let s3 = compute(std::slice::from_ref(&&sheet), &t, 3, &env).unwrap();
    assert_eq!(get(&s3, "color"), "#00f");
    assert_eq!(get(&s3, "cursor"), "pointer");
    assert_eq!(get(&s3, "text-align"), "center");
    assert_eq!(get(&s3, "text-decoration"), "line-through");
    // no `+` previous sibling → no bold
    assert!(s3.get("font-weight").is_none());

    // item 4: nth-child(2), has previous sibling → bold
    let s4 = compute(std::slice::from_ref(&&sheet), &t, 4, &env).unwrap();
    assert_eq!(get(&s4, "color"), "green");
    assert_eq!(get(&s4, "font-weight"), "700");
    assert_eq!(get(&s4, "opacity"), ".5");
    assert_eq!(get(&s4, "text-decoration"), "line-through");

    // item 5: last-child; :not(.skip) applies
    let s5 = compute(std::slice::from_ref(&&sheet), &t, 5, &env).unwrap();
    assert_eq!(get(&s5, "color"), "#ff0");
    assert_eq!(get(&s5, "cursor"), "pointer");
}

#[test]
fn state_pseudos_match() {
    let css = r"
        .btn { color: gray }
        .btn:hover { color: white }
        .btn:active { color: black }
        .btn:focus { outline: 1px }
        .btn:focus-within { border-color: cyan }
        ";
    let sheet = stylesheet(css);
    let sheet = sheet.sheet();
    let t = tree(
        vec![
            node("app"),
            {
                let mut n = node("btn");
                n.classes = vec!["btn".into()];
                n.hover = true;
                n
            },
            {
                let mut n = node("btn");
                n.classes = vec!["btn".into()];
                n.active = true;
                n.focus = true;
                n
            },
        ],
        vec![NO_PARENT, 0, 0],
    );
    let env = Environment::default();
    assert_eq!(
        get(
            &compute(std::slice::from_ref(&&sheet), &t, 1, &env).unwrap(),
            "color"
        ),
        "#fff"
    );
    let s2 = compute(std::slice::from_ref(&&sheet), &t, 2, &env).unwrap();
    assert_eq!(get(&s2, "color"), "#000");
    assert_eq!(get(&s2, "outline"), "1px");
    // app has no focus; focus-within on ancestors of focused node — app is ancestor, but we only computed leaf nodes; focus-within on btn itself also true
    assert_eq!(get(&s2, "border-color"), "#0ff");
}

#[test]
fn cascades_by_origin_layer_specificity_order() {
    // One shared IR owner: every stylesheet borrows its parsed selectors
    // from the same `CompiledStylesheet` list (the borrow of a
    // `SelectorList` is invariant, so multi-sheet calls need one owner).
    let mut irs = Vec::new();
    let mut push = |css: &str, origin: Origin, index: usize| {
        let out = compile(css, origin, Default::default());
        assert!(out.diagnostics.is_empty(), "{:?}", out.diagnostics);
        irs.push((out.sheet.expect("sheet"), index));
    };
    push(".x { color: red; padding: 1px }", Origin::Author, 0);
    push(".x { color: green }", Origin::Author, 1);
    push(".x { color: blue !important }", Origin::Author, 2);
    push("@layer a { .x { color: cyan } }", Origin::Author, 3);
    push(".x { color: white !important }", Origin::User, 4);
    let sheets: Vec<Stylesheet> = irs
        .iter()
        .map(|(ir, index)| Stylesheet::from_ir(ir, *index))
        .collect();
    let [author, author_later, author_important, layered, important_user] = &sheets[..] else {
        panic!("five sheets");
    };

    let t = tree(
        vec![{
            let mut n = node("div");
            n.classes = vec!["x".into()];
            n
        }],
        vec![NO_PARENT],
    );
    let env = Environment::default();

    // Later author rule wins over earlier.
    let s = compute(&[&author, &author_later], &t, 0, &env).unwrap();
    assert_eq!(get(&s, "color"), "green");
    assert_eq!(get(&s, "padding"), "1px");

    // !important beats normal even from an earlier sheet.
    let s = compute(&[&author, &author_important], &t, 0, &env).unwrap();
    assert_eq!(get(&s, "color"), "#00f");

    // Unlayered beats layered.
    let s = compute(&[&author, &layered], &t, 0, &env).unwrap();
    assert_eq!(get(&s, "color"), "red");

    // User !important beats author !important.
    let s = compute(&[&author_important, &important_user], &t, 0, &env).unwrap();
    assert_eq!(get(&s, "color"), "#fff");

    // Specificity: #id beats .class.
    let specific_case = stylesheet("#y { color: purple } .x { color: orange }");
    let specific = specific_case.sheet();
    let t2 = tree(
        vec![{
            let mut n = node("div");
            n.id = Some("y".into());
            n.classes = vec!["x".into()];
            n
        }],
        vec![NO_PARENT],
    );
    let s = compute(&[&specific], &t2, 0, &env).unwrap();
    assert_eq!(get(&s, "color"), "purple");
}

#[test]
fn inherits_and_resolves_custom_properties() {
    let css = r"
        :root {
          --brand: oklch(70% .2 40);
          --gap: 8px;
          color: var(--brand);
        }
        .box { border-color: var(--brand); margin: var(--gap) }
        .box { --gap: 4px }
        .leaf { border-color: inherit }
        ";
    let sheet = stylesheet(css);
    let sheet = sheet.sheet();
    let t = tree(
        vec![
            node("root"), // 0
            {
                let mut n = node("box");
                n.classes = vec!["box".into()];
                n
            }, // 1
            {
                let mut n = node("leaf");
                n.classes = vec!["leaf".into()];
                n
            }, // 2
        ],
        vec![NO_PARENT, 0, 1],
    );
    let env = Environment::default();

    let s0 = compute(std::slice::from_ref(&&sheet), &t, 0, &env).unwrap();
    assert_eq!(get(&s0, "color"), "oklch(70% .2 40)");
    assert_eq!(get(&s0, "--brand"), "oklch(70% .2 40)");

    // color inherits from root; --gap overridden locally; border-color via var
    let s1 = compute(std::slice::from_ref(&&sheet), &t, 1, &env).unwrap();
    assert_eq!(get(&s1, "color"), "oklch(70% .2 40)");
    assert_eq!(get(&s1, "border-color"), "oklch(70% .2 40)");
    assert_eq!(get(&s1, "margin"), "4px");
    assert_eq!(get(&s1, "--gap"), "4px");

    // explicit inherit keyword pulls parent's border-color
    let s2 = compute(std::slice::from_ref(&&sheet), &t, 2, &env).unwrap();
    assert_eq!(get(&s2, "border-color"), "oklch(70% .2 40)");
    assert_eq!(get(&s2, "--gap"), "4px");
}

#[test]
fn var_fallbacks_and_cycles() {
    let css = r"
        .a { color: var(--missing, red) }
        .b { --x: var(--y); --y: var(--x); color: var(--x) }
        .c { color: var(--missing) }
        ";
    let sheet = stylesheet(css);
    let sheet = sheet.sheet();
    let t = tree(
        vec![
            {
                let mut n = node("d");
                n.classes = vec!["a".into()];
                n
            },
            {
                let mut n = node("d");
                n.classes = vec!["b".into()];
                n
            },
            {
                let mut n = node("d");
                n.classes = vec!["c".into()];
                n
            },
        ],
        vec![NO_PARENT, NO_PARENT, NO_PARENT],
    );
    let env = Environment::default();
    assert_eq!(
        get(
            &compute(std::slice::from_ref(&&sheet), &t, 0, &env).unwrap(),
            "color"
        ),
        "red"
    );
    // Cycle → declaration dropped.
    assert!(
        compute(std::slice::from_ref(&&sheet), &t, 1, &env)
            .unwrap()
            .get("color")
            .is_none()
    );
    // Missing without fallback → dropped.
    assert!(
        compute(std::slice::from_ref(&&sheet), &t, 2, &env)
            .unwrap()
            .get("color")
            .is_none()
    );
}

#[test]
fn evaluates_media_container_supports() {
    let css = r"
        @media (min-width: 400px) { .m { color: red } }
        @media (min-width: 1000px) { .m { color: green } }
        @media (prefers-color-scheme: dark) { .m { color: white } }
        @container panel (inline-size > 300px) { .c { color: blue } }
        @supports (color: oklch(70% .2 40)) { .s { color: oklch(70% .2 40) } }
        @supports (bogus-property: 1px) { .s { color: black } }
        ";
    let sheet = stylesheet(css);
    let sheet = sheet.sheet();
    let t = tree(
        vec![
            {
                let mut n = node("app");
                n.width = Some(500.0);
                n.height = Some(100.0);
                n
            }, // container
            {
                let mut n = node("m");
                n.classes = vec!["m".into()];
                n
            },
            {
                let mut n = node("c");
                n.classes = vec!["c".into()];
                n
            },
            {
                let mut n = node("s");
                n.classes = vec!["s".into()];
                n
            },
        ],
        vec![NO_PARENT, 0, 0, 0],
    );
    let env = Environment {
        viewport_width: Some(600.0),
        viewport_height: Some(800.0),
        color_scheme: bombshell_css_core::ColorScheme::Dark,
        ..Default::default()
    };
    // Both the 400px rule and the dark-scheme rule match; the dark rule is
    // later in source order, so it wins.
    let s1 = compute(std::slice::from_ref(&&sheet), &t, 1, &env).unwrap();
    assert_eq!(get(&s1, "color"), "#fff");

    // With a light scheme only the viewport rule matches.
    let light = Environment {
        viewport_width: Some(600.0),
        viewport_height: Some(800.0),
        ..Default::default()
    };
    let s1 = compute(std::slice::from_ref(&&sheet), &t, 1, &light).unwrap();
    assert_eq!(get(&s1, "color"), "red");

    let s2 = compute(std::slice::from_ref(&&sheet), &t, 2, &env).unwrap();
    assert!(s2.get("color").is_none(), "no container ancestor yet");

    let s3 = compute(std::slice::from_ref(&&sheet), &t, 3, &env).unwrap();
    assert_eq!(get(&s3, "color"), "oklch(70% .2 40)");
}

#[test]
fn container_queries_evaluate_against_ancestors() {
    let css = r"
        .panel {
          container-type: inline-size;
          container-name: panel;
        }
        @container panel (inline-size > 300px) { .card { color: blue } }
        @container (inline-size <= 300px) { .card { color: red } }
        @container panel (width > 600px) { .card { font-weight: bold } }
        ";
    let sheet = stylesheet(css);
    let sheet = sheet.sheet();
    let t = tree(
        vec![
            {
                let mut n = node("panel");
                n.classes = vec!["panel".into()];
                n.width = Some(400.0);
                n
            },
            {
                let mut n = node("card");
                n.classes = vec!["card".into()];
                n
            },
        ],
        vec![NO_PARENT, 0],
    );
    let env = Environment::default();
    let s = compute(std::slice::from_ref(&&sheet), &t, 1, &env).unwrap();
    assert_eq!(get(&s, "color"), "#00f");
    assert!(s.get("font-weight").is_none());

    // Small container
    let t2 = tree(
        vec![
            {
                let mut n = node("panel");
                n.classes = vec!["panel".into()];
                n.width = Some(200.0);
                n
            },
            {
                let mut n = node("card");
                n.classes = vec!["card".into()];
                n
            },
        ],
        vec![NO_PARENT, 0],
    );
    let s = compute(std::slice::from_ref(&&sheet), &t2, 1, &env).unwrap();
    assert_eq!(get(&s, "color"), "red");
}

#[test]
fn dark_scheme_and_state_via_nesting() {
    let css = r"
        .btn {
          color: black;
          &:hover { color: white }
          @media (prefers-color-scheme: dark) {
            & { color: light-dark(white, black) }
          }
        }
        ";
    let sheet = stylesheet(css);
    let sheet = sheet.sheet();
    let t = tree(
        vec![{
            let mut n = node("btn");
            n.classes = vec!["btn".into()];
            n.hover = true;
            n
        }],
        vec![NO_PARENT],
    );
    let env = Environment {
        color_scheme: bombshell_css_core::ColorScheme::Dark,
        ..Default::default()
    };
    let s = compute(std::slice::from_ref(&&sheet), &t, 0, &env).unwrap();
    // :hover and dark-mode rules both match; dark rule is later in source order.
    assert_eq!(get(&s, "color"), "#fff");
}

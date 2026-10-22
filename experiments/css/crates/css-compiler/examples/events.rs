use bombshell_css_compiler::{CompileOptions, compile};
use bombshell_css_core::Origin;

fn main() {
    if let Some(path) = std::env::args().nth(2) {
        let css = std::fs::read_to_string(&path).unwrap();
        let out = compile(&css, Origin::Author, Default::default());
        let sheet = out.sheet.unwrap();
        for rule in &sheet.rules {
            println!("{} media={:#?}", rule.selector, rule.media);
        }
        if !sheet.warnings.is_empty() {
            println!("warnings: {:#?}", sheet.warnings);
        }
        return;
    }
    let skip: usize = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(0);
    for css in [
        ".a { color: red }",
        "@layer base;",
        "@layer base.type { .a { color: red } }",
        "@media (min-width: 24em) { .a { color: red } }",
        "@media (min-width: 24em) { @container panel (inline-size > 45em) { @supports (color: oklch(70% 0.2 40)) { .b { color: blue } } } }",
        ".card { color: red; & > .title { font-weight: bold } .body { color: blue } }",
        "@layer base;\n@layer base.type { .a { color: red } }",
        "@keyframes pulse { from { opacity: 1 } to { opacity: 0 } }\n@font-face { font-family: X; src: url(x.woff2) }",
        ".a { color: red } .a:hover { color: blue }",
        ".card { color: oklch(70% 0.2 40); & > .title { font-weight: bold; &:hover { text-decoration: underline; } } }",
        "@media (prefers-color-scheme: dark) { .a { color: green } }",
        "@media (prefers-reduced-motion: reduce) { .a { color: blue } }",
        "@media screen and (not (hover)) { .a { color: orange } }",
        ".btn { color: gray }\n.btn:hover { color: white }\n.btn:active { color: black }\n.btn:focus { outline: 1px }\n.btn:focus-within { border-color: cyan }",
        ".item:first-child { color: blue }\n.root .item { color: green }",
        ".item:nth-child(2n + 1 of .tagged) { color: yellow }\n.item:not(.skip):not(.list > *) { color: blue }",
        ":root { --brand: oklch(70% .2 40); --gap: 8px; color: var(--brand) }\n.box { border-color: var(--brand); margin: var(--gap) }\n.box { --gap: 4px }",
    ]
    .into_iter()
    .enumerate()
    .skip(skip)
    {
        let (i, css) = css;
        println!("[case {i}]");
        let out = compile(css, Origin::Author, CompileOptions::default());
        match &out.sheet {
            Some(sheet) => {
                println!("--- {:?}\n    rules={} layers={:?} keyframes={} opaque={}", css, sheet.rules.len(), sheet.layer_order, sheet.keyframes.len(), sheet.opaque.len());
                for rule in &sheet.rules {
                    println!("    {} sp={:#x} decls={:?}", rule.selector, rule.specificity, rule.declarations);
                }
            }
            None => println!("--- {:?}\n    FAILED {:?}", css, out.diagnostics),
        }
        if !out.diagnostics.is_empty() {
            println!("    diags: {:?}", out.diagnostics);
        }
    }
}

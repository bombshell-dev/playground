//! Compile-throughput probe for the bench corpus shape.

use std::time::Instant;

use bombshell_css_compiler::{CompileOptions, compile};
use bombshell_css_core::Origin;

fn main() {
    let css = std::fs::read_to_string(
        std::env::args().nth(1).expect("corpus path argument"),
    )
    .expect("corpus file");

    for _ in 0..5 {
        let _ = compile(&css, Origin::Author, CompileOptions::default());
    }
    let mut times = Vec::new();
    for _ in 0..30 {
        let start = Instant::now();
        let out = compile(&css, Origin::Author, CompileOptions::default());
        times.push(start.elapsed());
        let _ = out;
    }
    times.sort();
    let median = times[times.len() / 2];
    println!(
        "native compile: median {:.2?} → {:.1} MB/s",
        median,
        css.len() as f64 / median.as_secs_f64() / 1_048_576.0
    );
}

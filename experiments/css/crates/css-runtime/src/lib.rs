//! Selector matching and cascade for the Bombshell CSS pipeline.
//!
//! The runtime consumes the versioned stylesheet IR emitted by
//! `bombshell-css-compiler` (or any host that produces the same contract)
//! and resolves computed styles against a flat DOM [`TreeSnapshot`]:
//!
//! - selector matching via `parcel_selectors`, the engine lightningcss
//!   itself uses, adapted to the snapshot model (see [`selectors`] and
//!   [`element`]);
//! - cascade by origin/importance, `@layer`, specificity, and source order
//!   (see [`cascade`]);
//! - inheritance, custom properties, `var()` substitution, and CSS-wide
//!   keywords;
//! - `@media`, `@container`, and `@supports` condition evaluation against
//!   the [`Environment`] (see [`conditions`]).

pub mod cascade;
pub mod conditions;
pub mod element;
pub mod selectors;
pub mod values;

pub use bombshell_css_core::{Environment, NodeSnapshot, TreeSnapshot};

pub use cascade::{ComputedStyle, Stylesheet};
pub use conditions::{ContainerAncestor, ContainerType};
pub use element::MatchElement;
pub use selectors::{SelectorList, parse_selector_list};

/// Resolve the computed style for `target`.
pub fn compute<'ir>(
    sheets: &[Stylesheet<'ir>],
    tree: &TreeSnapshot,
    target: usize,
    env: &Environment,
) -> Option<ComputedStyle<'ir>> {
    cascade::compute(sheets, tree, target, env)
}

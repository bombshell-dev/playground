//! Matching glue over the selector engine (which lives in `bombshell-css-core`
//! so the compiler and runtime share one parser).

pub use bombshell_css_core::selectors::*;

use crate::element::MatchElement;
use parcel_selectors::matching::matches_selector;
use parcel_selectors::parser::{NthSelectorData, NthType};
use parcel_selectors::{Element as ParcelElement, NthIndexCache};

/// Match one relative selector (from `:has()`) with `scope` pinned to the
/// anchoring element.
pub(crate) fn matches_relative(
    selector: &Selector,
    candidate: &MatchElement,
    scope: &MatchElement,
) -> bool {
    let mut nth_cache = NthIndexCache::default();
    let mut context = parcel_selectors::context::MatchingContext::new(
        parcel_selectors::context::MatchingMode::Normal,
        None,
        Some(&mut nth_cache),
        parcel_selectors::context::QuirksMode::NoQuirks,
    );
    context.scope_element = Some(scope.opaque());
    let mut flags = |_: &MatchElement, _: parcel_selectors::matching::ElementSelectorFlags| {};
    matches_selector(selector, 0, None, candidate, &mut context, &mut flags)
}

/// Nth arithmetic shared by the `NthOf` evaluator.
pub(crate) fn nth_matches(nth: &NthSelectorData, count: i32) -> bool {
    if matches!(nth.ty, NthType::Col | NthType::LastCol) {
        return false;
    }
    if nth.a == 0 {
        return count == nth.b;
    }
    let delta = count - nth.b;
    delta % nth.a == 0 && delta / nth.a >= 0
}

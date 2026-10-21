//! The `parcel_selectors::Element` implementation over the flat
//! [`TreeSnapshot`], plus the runtime semantics for pseudo-classes,
//! `:has()` traversal, and `:nth-child(.. of S)` counting.

use crate::selectors::{PseudoClass, Selectors, matches_relative, nth_matches};
use bombshell_css_core::{NO_PARENT, NodeSnapshot, TreeSnapshot};
use parcel_selectors::attr::CaseSensitivity;
use parcel_selectors::attr::{AttrSelectorOperation, NamespaceConstraint};
use parcel_selectors::context::MatchingContext;
use parcel_selectors::matching::ElementSelectorFlags;
use parcel_selectors::parser::{NthOfSelectorData, NthType};
use parcel_selectors::{Element as ParcelElement, OpaqueElement};

/// A view of one node in a [`TreeSnapshot`], cheap to clone.
#[derive(Clone, Copy, Debug)]
pub struct MatchElement<'a> {
    pub tree: &'a TreeSnapshot,
    pub index: usize,
}

impl<'a> MatchElement<'a> {
    pub fn new(tree: &'a TreeSnapshot, index: usize) -> Option<Self> {
        (index < tree.nodes.len()).then_some(MatchElement { tree, index })
    }

    pub fn node(&self) -> &'a NodeSnapshot {
        &self.tree.nodes[self.index]
    }

    pub(crate) fn attr(&self, name: &str) -> Option<&'a str> {
        self.node()
            .attributes
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }

    /// Resolve an inheritable-ish attribute by walking up the chain
    /// (used for `lang` and `dir`).
    fn inherited_attr(&self, name: &str) -> Option<&'a str> {
        let mut current = *self;
        loop {
            if let Some(value) = current.attr(name) {
                return Some(value);
            }
            match current.parent_element() {
                Some(parent) => current = parent,
                None => return None,
            }
        }
    }

    /// Sibling indices sharing this node's parent (contiguous run).
    fn siblings(&self) -> impl Iterator<Item = usize> + '_ {
        let parent = self.tree.parents.get(self.index).copied();
        let tree = self.tree;
        let mut start = self.index;
        while start > 0 && tree.parents.get(start - 1).copied() == parent {
            start -= 1;
        }
        let mut end = self.index;
        while end + 1 < tree.nodes.len() && tree.parents.get(end + 1).copied() == parent {
            end += 1;
        }
        start..=end
    }

    /// All descendants (depth first, document order).
    fn descendants(&self) -> impl Iterator<Item = usize> + '_ {
        let tree = self.tree;
        let mut stack: Vec<usize> = Vec::new();
        // Collect children eagerly (reverse for DFS order).
        let children: Vec<usize> = tree
            .parents
            .iter()
            .enumerate()
            .filter(|&(_, p)| *p == self.index as u32)
            .map(|(i, _)| i)
            .collect();
        for child in children.iter().rev() {
            stack.push(*child);
        }
        std::iter::from_fn(move || {
            let index = stack.pop()?;
            for child in tree
                .parents
                .iter()
                .enumerate()
                .filter(|&(_, p)| *p == index as u32)
                .map(|(i, _)| i)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
            {
                stack.push(child);
            }
            Some(index)
        })
    }

    /// Following siblings of this element and all of their descendants.
    fn following_siblings_and_descendants(&self) -> impl Iterator<Item = usize> + '_ {
        let tree = self.tree;
        let parent = self.tree.parents.get(self.index).copied();
        let following: Vec<usize> = (self.index + 1..tree.nodes.len())
            .filter(|&i| tree.parents.get(i).copied() == parent)
            .collect();
        following.into_iter().flat_map(move |sibling| {
            std::iter::once(sibling).chain(
                MatchElement::new(tree, sibling)
                    .map(|el| el.descendants().collect::<Vec<_>>())
                    .unwrap_or_default(),
            )
        })
    }

    fn has_focus_within(&self) -> bool {
        if self.node().focus {
            return true;
        }
        self.descendants().any(|i| self.tree.nodes[i].focus)
    }

    /// Candidates addressable by `:has()` relative selectors: everything
    /// anchored at this element — its descendants, its following siblings,
    /// and the descendants of those siblings.
    fn has_candidates(&self) -> impl Iterator<Item = MatchElement<'a>> + '_ {
        self.descendants()
            .chain(self.following_siblings_and_descendants())
            .filter_map(move |index| MatchElement::new(self.tree, index))
    }

    fn matches_any_of(
        &self,
        selectors: &[crate::selectors::Selector],
        scope: &MatchElement,
    ) -> bool {
        selectors
            .iter()
            .any(|selector| matches_relative(selector, self, scope))
    }

    fn nth_of_matches(&self, data: &NthOfSelectorData<'_, Selectors>) -> bool {
        let nth = data.nth_data();
        if matches!(nth.ty, NthType::Col | NthType::LastCol) {
            return false;
        }
        let mut nth_cache = parcel_selectors::NthIndexCache::default();
        let mut context = MatchingContext::new(
            parcel_selectors::context::MatchingMode::Normal,
            None,
            Some(&mut nth_cache),
            parcel_selectors::context::QuirksMode::NoQuirks,
        );
        let mut flags = |_: &MatchElement, _: ElementSelectorFlags| {};

        let of_selectors = data.selectors();
        let mut matches_of = |index: usize| -> bool {
            MatchElement::new(self.tree, index).is_some_and(|el| {
                of_selectors.iter().any(|selector| {
                    parcel_selectors::matching::matches_selector(
                        selector,
                        0,
                        None,
                        &el,
                        &mut context,
                        &mut flags,
                    )
                })
            })
        };

        let from_end = matches!(nth.ty, NthType::LastChild | NthType::LastOfType);
        let of_type = matches!(nth.ty, NthType::OfType | NthType::LastOfType);

        let mut matching: Vec<usize> = Vec::new();
        for sibling in self.siblings() {
            if of_type && self.tree.nodes[sibling].tag != self.node().tag {
                continue;
            }
            if !of_selectors.is_empty() && !matches_of(sibling) {
                continue;
            }
            matching.push(sibling);
        }

        let count = if from_end {
            matching
                .iter()
                .rposition(|&i| i == self.index)
                .map(|p| p + 1)
        } else {
            matching
                .iter()
                .position(|&i| i == self.index)
                .map(|p| p + 1)
        };
        let Some(count) = count else { return false };
        nth_matches(data.nth_data(), count as i32)
    }
}

impl<'i, 'a> ParcelElement<'i> for MatchElement<'a> {
    type Impl = Selectors;

    fn opaque(&self) -> OpaqueElement {
        OpaqueElement::new(&self.tree.nodes[self.index])
    }

    fn parent_element(&self) -> Option<Self> {
        self.tree
            .parent_of(self.index)
            .and_then(|index| MatchElement::new(self.tree, index))
    }

    fn parent_node_is_shadow_root(&self) -> bool {
        false
    }

    fn containing_shadow_host(&self) -> Option<Self> {
        None
    }

    fn is_pseudo_element(&self) -> bool {
        false
    }

    fn prev_sibling_element(&self) -> Option<Self> {
        let parent = self.tree.parents.get(self.index).copied();
        (self.index > 0 && self.tree.parents.get(self.index - 1).copied() == parent).then(|| {
            MatchElement {
                tree: self.tree,
                index: self.index - 1,
            }
        })
    }

    fn next_sibling_element(&self) -> Option<Self> {
        let parent = self.tree.parents.get(self.index).copied();
        (self.index + 1 < self.tree.nodes.len()
            && self.tree.parents.get(self.index + 1).copied() == parent)
            .then(|| MatchElement {
                tree: self.tree,
                index: self.index + 1,
            })
    }

    fn is_html_element_in_html_document(&self) -> bool {
        false
    }

    fn has_local_name(&self, local_name: &str) -> bool {
        self.node().tag == local_name
    }

    fn has_namespace(&self, ns: &str) -> bool {
        ns.is_empty()
    }

    fn is_same_type(&self, other: &Self) -> bool {
        self.node().tag == other.node().tag
    }

    fn attr_matches(
        &self,
        ns: &NamespaceConstraint<
            &<Selectors as parcel_selectors::parser::SelectorImpl<'i>>::NamespaceUrl,
        >,
        local_name: &<Selectors as parcel_selectors::parser::SelectorImpl<'i>>::LocalName,
        operation: &AttrSelectorOperation<
            &<Selectors as parcel_selectors::parser::SelectorImpl<'i>>::AttrValue,
        >,
    ) -> bool {
        let namespace_ok = match ns {
            NamespaceConstraint::Any => true,
            // Elements live in no namespace; only the empty URL can match.
            NamespaceConstraint::Specific(url) => url.as_ref().is_empty(),
        };
        if !namespace_ok {
            return false;
        }
        let name = local_name.as_ref();
        let Some(value) = self.attr(name) else {
            return false;
        };
        // `eval_str` implements the full operator semantics (including the
        // `i`/`s` flags resolved by the parser).
        operation.eval_str(value)
    }

    fn match_non_ts_pseudo_class<F>(
        &self,
        pc: &PseudoClass<'i>,
        _context: &mut MatchingContext<'_, 'i, Selectors>,
        _flags_setter: &mut F,
    ) -> bool
    where
        F: FnMut(&Self, ElementSelectorFlags),
    {
        let node = self.node();
        match pc {
            PseudoClass::Hover => node.hover,
            PseudoClass::Active => node.active,
            PseudoClass::Focus => node.focus,
            PseudoClass::FocusVisible => node.focus,
            PseudoClass::FocusWithin => self.has_focus_within(),
            PseudoClass::Disabled => self.attr("disabled").is_some(),
            PseudoClass::Enabled => self.attr("disabled").is_none(),
            PseudoClass::Checked => self.attr("checked").is_some(),
            PseudoClass::Required => self.attr("required").is_some(),
            PseudoClass::Optional => self.attr("required").is_none(),
            PseudoClass::ReadOnly => {
                self.attr("readonly").is_some() || self.attr("disabled").is_some()
            }
            PseudoClass::ReadWrite => {
                self.attr("readonly").is_none() && self.attr("disabled").is_none()
            }
            PseudoClass::PlaceholderShown => self.attr("placeholder").is_some(),
            PseudoClass::Lang(languages) => self
                .inherited_attr("lang")
                .is_some_and(|lang| languages.iter().any(|want| lang_matches(lang, want))),
            PseudoClass::Dir(dir) => self
                .inherited_attr("dir")
                .is_some_and(|value| value.eq_ignore_ascii_case(&*dir)),
            PseudoClass::NthOf(data) => self.nth_of_matches(data),
            PseudoClass::Has(selectors) => self
                .has_candidates()
                .any(|candidate| candidate.matches_any_of(selectors, self)),
            PseudoClass::NeverMatches => false,
        }
    }

    fn match_pseudo_element(
        &self,
        _pe: &crate::selectors::PseudoElement,
        _context: &mut MatchingContext<'_, 'i, Selectors>,
    ) -> bool {
        false
    }

    fn is_link(&self) -> bool {
        false
    }

    fn is_html_slot_element(&self) -> bool {
        false
    }

    fn has_id(
        &self,
        id: &<Selectors as parcel_selectors::parser::SelectorImpl<'i>>::Identifier,
        case_sensitivity: CaseSensitivity,
    ) -> bool {
        self.node()
            .id
            .as_deref()
            .is_some_and(|value| case_eq(case_sensitivity, value, id.as_ref()))
    }

    fn has_class(
        &self,
        name: &<Selectors as parcel_selectors::parser::SelectorImpl<'i>>::Identifier,
        case_sensitivity: CaseSensitivity,
    ) -> bool {
        self.node()
            .classes
            .iter()
            .any(|class| case_eq(case_sensitivity, class, name.as_ref()))
    }

    fn imported_part(
        &self,
        _name: &<Selectors as parcel_selectors::parser::SelectorImpl<'i>>::Identifier,
    ) -> Option<<Selectors as parcel_selectors::parser::SelectorImpl<'i>>::Identifier> {
        None
    }

    fn is_part(
        &self,
        _name: &<Selectors as parcel_selectors::parser::SelectorImpl<'i>>::Identifier,
    ) -> bool {
        false
    }

    fn is_empty(&self) -> bool {
        !self.tree.parents.contains(&(self.index as u32))
    }

    fn is_root(&self) -> bool {
        matches!(self.tree.parents.get(self.index), None | Some(&NO_PARENT))
    }

    fn ignores_nth_child_selectors(&self) -> bool {
        false
    }
}

fn case_eq(case_sensitivity: CaseSensitivity, a: &str, b: &str) -> bool {
    match case_sensitivity {
        CaseSensitivity::CaseSensitive => a == b,
        CaseSensitivity::AsciiCaseInsensitive => a.eq_ignore_ascii_case(b),
    }
}

/// CSS `lang()` matching: exact (case-insensitive) or wildcard prefix on `-`.
fn lang_matches(actual: &str, wanted: &str) -> bool {
    let actual = actual.trim();
    let wanted = wanted.trim();
    actual.eq_ignore_ascii_case(wanted)
        || (actual
            .get(..wanted.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(wanted))
            && actual.as_bytes().get(wanted.len()) == Some(&b'-'))
}

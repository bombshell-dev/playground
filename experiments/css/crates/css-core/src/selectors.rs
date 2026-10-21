//! The selector engine: a `parcel_selectors` `SelectorImpl` for the Bombshell
//! DOM snapshot model, the parser that accepts canonical selector text, and
//! the desugaring pass that rewrites components the matcher cannot execute
//! (`Nesting`, `Has`, `NthOf`, shadow-DOM parts) into interception points
//! owned by the runtime.
//!
//! Both the compiler (validation + specificity) and the runtime (matching)
//! drive this one parser, so the two sides can never disagree about what a
//! valid selector is.

#![cfg(feature = "selectors")]

use alloc::boxed::Box;
use alloc::vec::Vec;

use cssparser::{
    CowRcStr, ParseError, Parser as CssParser, ParserInput, ToCss, match_ignore_ascii_case,
};
use parcel_selectors::context::{MatchingContext, MatchingMode, QuirksMode};
use parcel_selectors::matching::matches_selector_list;
use parcel_selectors::parser::{
    Component, NestingRequirement, NthOfSelectorData, ParseErrorRecovery,
    Parser as SelectorParserTrait, SelectorImpl, SelectorParseErrorKind,
};
use parcel_selectors::{NthIndexCache, SelectorList as ParcelSelectorList};

use alloc::borrow::Cow;
use core::fmt;

/// `SelectorImpl` for the pipeline: identifiers are ref-counted strings.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Selectors;

pub type SelectorList<'i> = ParcelSelectorList<'i, Selectors>;
pub type Selector<'i> = parcel_selectors::parser::Selector<'i, Selectors>;

/// An interned-ish identifier backed by `CowRcStr`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Ident<'i>(pub CowRcStr<'i>);

impl<'i> From<CowRcStr<'i>> for Ident<'i> {
    fn from(value: CowRcStr<'i>) -> Self {
        Ident(value)
    }
}

impl<'i> From<Cow<'i, str>> for Ident<'i> {
    fn from(value: Cow<'i, str>) -> Self {
        Ident(CowRcStr::from(value))
    }
}

impl AsRef<str> for Ident<'_> {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl<'i> core::borrow::Borrow<str> for Ident<'i> {
    fn borrow(&self) -> &str {
        &self.0
    }
}

impl Default for Ident<'_> {
    fn default() -> Self {
        Ident(CowRcStr::from(""))
    }
}

impl ToCss for Ident<'_> {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        dest.write_str(&self.0)
    }
}

/// Non-tree-structural pseudo-classes understood by the runtime matcher.
#[derive(Clone, PartialEq, Eq, Hash)]
pub enum PseudoClass<'i> {
    Hover,
    Active,
    Focus,
    FocusVisible,
    FocusWithin,
    Disabled,
    Enabled,
    Checked,
    Required,
    Optional,
    ReadOnly,
    ReadWrite,
    PlaceholderShown,
    Lang(Vec<CowRcStr<'i>>),
    Dir(CowRcStr<'i>),
    /// Desugared `:has(...)`; evaluated by traversal in the runtime.
    Has(Box<[Selector<'i>]>),
    /// Desugared `:nth-child(.. of S)`; evaluated by counting.
    NthOf(NthOfSelectorData<'i, Selectors>),
    /// Desugared components that can never match in the terminal model
    /// (`&` remnants, `:host`, `::slotted`, `::part`, unknowns).
    NeverMatches,
}

impl fmt::Debug for PseudoClass<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            PseudoClass::Hover => ":hover",
            PseudoClass::Active => ":active",
            PseudoClass::Focus => ":focus",
            PseudoClass::FocusVisible => ":focus-visible",
            PseudoClass::FocusWithin => ":focus-within",
            PseudoClass::Disabled => ":disabled",
            PseudoClass::Enabled => ":enabled",
            PseudoClass::Checked => ":checked",
            PseudoClass::Required => ":required",
            PseudoClass::Optional => ":optional",
            PseudoClass::ReadOnly => ":read-only",
            PseudoClass::ReadWrite => ":read-write",
            PseudoClass::PlaceholderShown => ":placeholder-shown",
            PseudoClass::Lang(_) => ":lang()",
            PseudoClass::Dir(_) => ":dir()",
            PseudoClass::Has(_) => ":has()",
            PseudoClass::NthOf(_) => ":nth-child(of)",
            PseudoClass::NeverMatches => ":never",
        })
    }
}

impl<'i> parcel_selectors::parser::NonTSPseudoClass<'i> for PseudoClass<'i> {
    type Impl = Selectors;

    fn is_active_or_hover(&self) -> bool {
        matches!(self, PseudoClass::Hover | PseudoClass::Active)
    }

    fn is_user_action_state(&self) -> bool {
        matches!(
            self,
            PseudoClass::Hover
                | PseudoClass::Active
                | PseudoClass::Focus
                | PseudoClass::FocusVisible
                | PseudoClass::FocusWithin
        )
    }
}

impl ToCss for PseudoClass<'_> {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        let name = match self {
            PseudoClass::Hover => "hover",
            PseudoClass::Active => "active",
            PseudoClass::Focus => "focus",
            PseudoClass::FocusVisible => "focus-visible",
            PseudoClass::FocusWithin => "focus-within",
            PseudoClass::Disabled => "disabled",
            PseudoClass::Enabled => "enabled",
            PseudoClass::Checked => "checked",
            PseudoClass::Required => "required",
            PseudoClass::Optional => "optional",
            PseudoClass::ReadOnly => "read-only",
            PseudoClass::ReadWrite => "read-write",
            PseudoClass::PlaceholderShown => "placeholder-shown",
            PseudoClass::Lang(_) => "lang",
            PseudoClass::Dir(_) => "dir",
            PseudoClass::Has(_) => "has",
            PseudoClass::NthOf(_) => "nth-child",
            PseudoClass::NeverMatches => return Ok(()),
        };
        dest.write_str(name)
    }
}

/// Pseudo-elements are parsed for syntax compatibility but never match: the
/// terminal engine has no generated content yet.
#[derive(Clone, PartialEq, Eq, Hash)]
pub enum PseudoElement {
    Before,
    After,
    Marker,
    Selection,
    FirstLine,
    FirstLetter,
    Placeholder,
    Backdrop,
    Unknown,
}

impl fmt::Debug for PseudoElement {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            PseudoElement::Before => "::before",
            PseudoElement::After => "::after",
            PseudoElement::Marker => "::marker",
            PseudoElement::Selection => "::selection",
            PseudoElement::FirstLine => "::first-line",
            PseudoElement::FirstLetter => "::first-letter",
            PseudoElement::Placeholder => "::placeholder",
            PseudoElement::Backdrop => "::backdrop",
            PseudoElement::Unknown => "::unknown",
        })
    }
}

impl parcel_selectors::parser::PseudoElement<'_> for PseudoElement {
    type Impl = Selectors;
}

impl ToCss for PseudoElement {
    fn to_css<W: fmt::Write>(&self, dest: &mut W) -> fmt::Result {
        let name = match self {
            PseudoElement::Before => "before",
            PseudoElement::After => "after",
            PseudoElement::Marker => "marker",
            PseudoElement::Selection => "selection",
            PseudoElement::FirstLine => "first-line",
            PseudoElement::FirstLetter => "first-letter",
            PseudoElement::Placeholder => "placeholder",
            PseudoElement::Backdrop => "backdrop",
            PseudoElement::Unknown => return Ok(()),
        };
        dest.write_str(name)
    }
}

/// Vendor prefixes never reach the runtime (compiler-canonical selectors,
/// `parse_any_prefix` returns `None`), so an uninhabited type satisfies the
/// `SelectorImpl` bounds.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum VendorPrefix {}

impl ToCss for VendorPrefix {
    fn to_css<W: fmt::Write>(&self, _dest: &mut W) -> fmt::Result {
        match *self {}
    }
}

impl<'i> SelectorImpl<'i> for Selectors {
    type ExtraMatchingData = ();
    type AttrValue = Ident<'i>;
    type Identifier = Ident<'i>;
    type LocalName = Ident<'i>;
    type NamespaceUrl = Ident<'i>;
    type NamespacePrefix = Ident<'i>;
    type BorrowedNamespaceUrl = str;
    type BorrowedLocalName = str;

    type NonTSPseudoClass = PseudoClass<'i>;
    type PseudoElement = PseudoElement;
    type VendorPrefix = VendorPrefix;
}

/// The selector parser for canonical compiler output.
pub struct SelectorParser;

impl<'i> SelectorParserTrait<'i> for SelectorParser {
    type Impl = Selectors;
    type Error = SelectorParseErrorKind<'i>;

    fn parse_is_and_where(&self) -> bool {
        true
    }

    fn parse_non_ts_pseudo_class(
        &self,
        _location: cssparser::SourceLocation,
        name: CowRcStr<'i>,
    ) -> Result<PseudoClass<'i>, ParseError<'i, Self::Error>> {
        match_ignore_ascii_case! { &name,
            "hover" => Ok(PseudoClass::Hover),
            "active" => Ok(PseudoClass::Active),
            "focus" => Ok(PseudoClass::Focus),
            "focus-visible" => Ok(PseudoClass::FocusVisible),
            "focus-within" => Ok(PseudoClass::FocusWithin),
            "disabled" => Ok(PseudoClass::Disabled),
            "enabled" => Ok(PseudoClass::Enabled),
            "checked" => Ok(PseudoClass::Checked),
            "required" => Ok(PseudoClass::Required),
            "optional" => Ok(PseudoClass::Optional),
            "read-only" => Ok(PseudoClass::ReadOnly),
            "read-write" => Ok(PseudoClass::ReadWrite),
            "placeholder-shown" => Ok(PseudoClass::PlaceholderShown),
            _ => Err(_location.new_custom_error(SelectorParseErrorKind::UnsupportedPseudoClass(name))),
        }
    }

    fn parse_non_ts_functional_pseudo_class<'t>(
        &self,
        name: CowRcStr<'i>,
        arguments: &mut CssParser<'i, 't>,
    ) -> Result<PseudoClass<'i>, ParseError<'i, Self::Error>> {
        match_ignore_ascii_case! { &name,
            "lang" => {
                let mut languages = Vec::new();
                loop {
                    if arguments
                        .try_parse(|i| i.expect_delim('*'))
                        .is_ok()
                    {
                        languages.push(CowRcStr::from("*"));
                    } else {
                        languages.push(arguments.expect_ident()?.clone());
                    }
                    if arguments.try_parse(|i| i.expect_comma()).is_err() {
                        break;
                    }
                }
                Ok(PseudoClass::Lang(languages))
            },
            "dir" => {
                let ident = arguments.expect_ident()?.clone();
                Ok(PseudoClass::Dir(ident))
            },
            _ => Err(arguments.new_custom_error(SelectorParseErrorKind::UnsupportedPseudoClass(name))),
        }
    }

    fn parse_pseudo_element(
        &self,
        _location: cssparser::SourceLocation,
        name: CowRcStr<'i>,
    ) -> Result<PseudoElement, ParseError<'i, Self::Error>> {
        match_ignore_ascii_case! { &name,
            "before" => Ok(PseudoElement::Before),
            "after" => Ok(PseudoElement::After),
            "marker" => Ok(PseudoElement::Marker),
            "selection" => Ok(PseudoElement::Selection),
            "first-line" => Ok(PseudoElement::FirstLine),
            "first-letter" => Ok(PseudoElement::FirstLetter),
            "placeholder" => Ok(PseudoElement::Placeholder),
            "backdrop" => Ok(PseudoElement::Backdrop),
            _ => Ok(PseudoElement::Unknown),
        }
    }
}

/// Per-element matching state: the `NthIndexCache` is element-scoped, so it
/// is built once per cascade step and shared across every rule matched
/// against that element.
pub struct MatchContext {
    cache: NthIndexCache,
}

impl Default for MatchContext {
    fn default() -> Self {
        Self::new()
    }
}

impl MatchContext {
    pub fn new() -> Self {
        MatchContext {
            cache: NthIndexCache::default(),
        }
    }

    /// Match a parsed selector list against one element.
    pub fn matches<'i, E>(
        &mut self,
        element: &E,
        list: &SelectorList<'i>,
    ) -> bool
    where
        E: parcel_selectors::Element<'i, Impl = Selectors>,
    {
        let mut context = MatchingContext::new(
            MatchingMode::Normal,
            None,
            Some(&mut self.cache),
            QuirksMode::NoQuirks,
        );
        matches_selector_list(list, element, &mut context)
    }
}

/// Whether the selector can never match in the terminal model: it carries a
/// pseudo-element (no generated content yet) or a desugared `NeverMatches`
/// component (`&` remnants, `:host`, `::slotted`, `::part`) at the top
/// level. Components nested inside functional pseudo-classes only disable
/// that inner branch, so they do not disqualify the selector.
pub fn selector_never_matches(selector: &Selector) -> bool {
    selector.has_pseudo_element()
        || selector
            .iter_raw_match_order()
            .any(|c| matches!(c, Component::NonTSPseudoClass(PseudoClass::NeverMatches)))
}

/// The "index keys" of a selector: tag/class/id names such that an element
/// missing all of them cannot match. Keys come from the rightmost compound
/// (positive requirements only — `:not()` contributes nothing, `:has()`
/// constrains descendants, not the element). An empty result means the
/// selector must always be tried.
///
/// `:is()`/`:where()` and `:nth-child(.. of S)` contribute the union of
/// their inner selectors' rightmost keys: the element has to satisfy at
/// least one inner selector, so it must carry one of their keys.
pub fn selector_keys<'i>(selector: &Selector<'i>) -> Vec<String> {
    let mut keys = Vec::new();
    collect_keys(selector, &mut keys);
    keys
}

fn collect_keys<'i>(selector: &Selector<'i>, keys: &mut Vec<String>) {
    // Raw match order runs right-to-left (matching starts at the rightmost
    // compound), so the keys come from the head of the iteration.
    for component in selector.iter_raw_match_order() {
        match component {
            Component::Combinator(..) => break,
            Component::Class(name) | Component::ID(name) => {
                keys.push(String::from(name.as_ref()))
            }
            Component::LocalName(name) => {
                // Both spellings: the matcher may consult either.
                keys.push(String::from(name.name.as_ref()));
                keys.push(String::from(name.lower_name.as_ref()));
            }
            Component::Is(list) | Component::Where(list) | Component::Any(_, list) => {
                for inner in &**list {
                    collect_keys(inner, keys);
                }
            }
            Component::NthOf(data) => {
                for inner in data.selectors() {
                    collect_keys(inner, keys);
                }
            }
            // `:not()` and `:has()` add no positive requirements on the
            // element itself; attributes and pseudo-classes add none either.
            _ => {}
        }
    }
}

/// Validate a (nesting-expanded) selector list and return its specificity:
/// the max across entries, parcel-packed `(ids << 20) | (classes << 10) |
/// elements`. Specificity comes from the same engine that matches at runtime
/// (`:is()`/`:not()` take the max of their arguments; `:where()`/`:has()`
/// contribute nothing).
pub fn validate_and_specificity(text: &str) -> Result<u32, ()> {
    let mut input = ParserInput::new(text);
    let mut parser = CssParser::new(&mut input);
    let list = SelectorList::parse(
        &SelectorParser,
        &mut parser,
        ParseErrorRecovery::DiscardList,
        NestingRequirement::None,
    )
    .map_err(|_| ())?;
    Ok(list.0.iter().map(|s| s.specificity()).max().unwrap_or(0))
}

/// Parse canonical selector text produced by the compiler.
///
/// The returned selectors borrow from `text`; keep the text alive for as
/// long as the list (the IR owns it, so loaded stylesheets hold it anyway).
pub fn parse_selector_list<'i>(
    text: &'i str,
) -> Result<SelectorList<'i>, ParseError<'i, SelectorParseErrorKind<'i>>> {
    let mut input = ParserInput::new(text);
    let mut parser = CssParser::new(&mut input);
    let mut list = SelectorList::parse(
        &SelectorParser,
        &mut parser,
        ParseErrorRecovery::IgnoreInvalidSelector,
        NestingRequirement::None,
    )?;
    desugar_list(&mut list);
    Ok(list)
}

/// Rewrite components the upstream matcher cannot execute:
///
/// - `Has(...)` → `PseudoClass::Has(...)`, evaluated by traversal
/// - `NthOf(...)` → `PseudoClass::NthOf(...)`, evaluated by counting
/// - `Nesting` (`&`), `Host`, `Slotted`, `Part` → `NeverMatches`
///
/// Desugaring preserves the specificity parcel computed at parse time
/// (`:has()` weighs 0 here where the spec takes the max of its arguments).
pub fn desugar_list(list: &mut SelectorList) {
    for selector in &mut list.0 {
        desugar_selector(selector);
    }
}

fn desugar_selector(selector: &mut Selector) {
    for component in selector.iter_mut_raw_match_order() {
        desugar_component(component);
    }
}

fn desugar_component(component: &mut Component<'_, Selectors>) {
    match component {
        Component::Has(_) => {
            let dummy = Component::ExplicitUniversalType;
            let old = core::mem::replace(component, dummy);
            if let Component::Has(selectors) = old {
                let mut selectors = selectors.into_vec();
                for selector in &mut selectors {
                    desugar_selector(selector);
                }
                *component =
                    Component::NonTSPseudoClass(PseudoClass::Has(selectors.into_boxed_slice()));
            }
        }
        Component::NthOf(_) => {
            let dummy = Component::ExplicitUniversalType;
            let old = core::mem::replace(component, dummy);
            if let Component::NthOf(data) = old {
                *component = Component::NonTSPseudoClass(PseudoClass::NthOf(data));
            }
        }
        Component::Nesting | Component::Host(_) | Component::Slotted(_) | Component::Part(_) => {
            *component = Component::NonTSPseudoClass(PseudoClass::NeverMatches);
        }
        Component::Is(selectors)
        | Component::Where(selectors)
        | Component::Negation(selectors)
        | Component::Any(_, selectors) => {
            for selector in selectors.iter_mut() {
                desugar_selector(selector);
            }
        }
        _ => {}
    }
}


//! Cascade resolution: origins and importance, `@layer` ordering,
//! specificity, source order, then inheritance and custom-property
//! resolution.

use std::borrow::Cow;

use crate::conditions::{
    ContainerAncestor, ContainerType, eval_container_list, eval_media_list, eval_supports_list,
};
use crate::selectors::parse_selector_list;
use crate::values::{resolve_light_dark, resolve_vars};
use bombshell_css_core::{CompiledStylesheet, ContainerQuery, Declaration, Origin, TreeSnapshot};
use rustc_hash::FxHashMap as HashMap;

/// Property map for one element: keys are canonical IR property names
/// (borrowed) or inline-style names (owned); values borrow the IR until a
/// `var()` substitution, inheritance, or an inline declaration materializes
/// something new.
pub type StyleMap<'ir> = HashMap<Cow<'ir, str>, Cow<'ir, str>>;

/// Properties that inherit by default (CSS-wide custom properties also
/// inherit unconditionally).
pub const INHERITED_PROPERTIES: &[&str] = &[
    "color",
    "opacity",
    "font",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "font-stretch",
    "font-variation-settings",
    "font-feature-settings",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "white-space",
    "text-align",
    "text-align-last",
    "text-transform",
    "text-indent",
    "text-underline-offset",
    "text-decoration-thickness",
    "text-emphasis-color",
    "text-emphasis-style",
    "visibility",
    "cursor",
    "direction",
    "writing-mode",
    "tab-size",
    "user-select",
    "list-style-type",
    "list-style-position",
    "border-collapse",
    "border-spacing",
    "caption-side",
    "empty-cells",
    "quotes",
    "orphans",
    "widows",
    "caret-color",
];

/// A stylesheet loaded for cascade: parsed selectors over the typed IR.
///
/// Borrows from the [`CompiledStylesheet`] it was loaded from; the IR owns
/// all selector and declaration text, so loading is allocation-free apart
/// from parsing.
#[derive(Clone)]
pub struct Stylesheet<'ir> {
    pub origin: Origin,
    pub sheet_index: usize,
    /// Rules in IR order; rules whose selectors failed to parse are skipped
    /// (their selector text shows up in [`Self::unmatched_selectors`]).
    pub rules: Vec<CascadeRule<'ir>>,
    pub layer_order: &'ir [Vec<String>],
    /// Candidate pre-filter: rule indices keyed by the tag/class/id names
    /// their selectors' rightmost compounds require. Matching only consults
    /// the element's own keys plus the always-checked bucket, which keeps
    /// per-frame work proportional to relevant rules instead of all rules.
    index: RuleIndex,
    parse_warnings: Vec<bombshell_css_core::Diagnostic>,
}

#[derive(Clone, Default)]
struct RuleIndex {
    /// Rule indices per index key; a key may name a class, a tag, or an id —
    /// collisions only add false-positive candidates, never miss one.
    /// Owned keys: the index is built once per stylesheet load.
    keys: HashMap<String, Vec<u32>>,
    /// Rules whose selectors carry no index key and are always checked.
    universal: Vec<u32>,
}

impl RuleIndex {
    fn build<'ir>(rules: &[CascadeRule<'ir>]) -> RuleIndex {
        let mut index = RuleIndex::default();
        for (rule_index, rule) in rules.iter().enumerate() {
            let rule_index = rule_index as u32;
            let mut keys: Vec<String> = Vec::new();
            let mut always = false;
            let mut indexable = false;
            for selector in &rule.parsed.0 {
                // Selectors that can never match are not indexed at all:
                // checking them per element would be pure waste.
                if bombshell_css_core::selectors::selector_never_matches(selector) {
                    continue;
                }
                indexable = true;
                let selector_keys = bombshell_css_core::selectors::selector_keys(selector);
                if selector_keys.is_empty() {
                    // One un-keyed selector in the list means any element
                    // could match through it.
                    always = true;
                    break;
                }
                keys.extend(selector_keys);
            }
            if !indexable {
                // Every selector is impossible; the rule can never match.
                continue;
            }
            if always || keys.is_empty() {
                index.universal.push(rule_index);
            } else {
                for key in keys {
                    index.keys.entry(key).or_default().push(rule_index);
                }
            }
        }
        index
    }
}

#[derive(Clone)]
pub struct CascadeRule<'ir> {
    /// Canonical selector text, for diagnostics and serialization.
    pub selector: &'ir str,
    pub parsed: crate::selectors::SelectorList<'ir>,
    pub specificity: u32,
    pub layer: Option<&'ir [String]>,
    pub media: &'ir [bombshell_css_core::MediaCondition],
    pub containers: &'ir [ContainerQuery],
    pub supports: &'ir [bombshell_css_core::SupportsCondition],
    pub declarations: &'ir [Declaration],
    pub order: u32,
}

impl<'ir> Stylesheet<'ir> {
    /// Load a stylesheet from decoded IR. Selectors that fail to parse are
    /// skipped (they are reported through [`Self::unmatched_selectors`]).
    pub fn from_ir(ir: &'ir CompiledStylesheet, sheet_index: usize) -> Stylesheet<'ir> {
        let mut rules = Vec::with_capacity(ir.rules.len());
        let mut parse_warnings = Vec::new();
        for rule in &ir.rules {
            match parse_selector_list(rule.selector.as_str()) {
                Ok(parsed) => rules.push(CascadeRule {
                    selector: rule.selector.as_str(),
                    parsed,
                    specificity: rule.specificity,
                    layer: rule.layer.as_deref(),
                    media: &rule.media,
                    containers: &rule.containers,
                    supports: &rule.supports,
                    declarations: &rule.declarations,
                    order: rule.order,
                }),
                Err(_) => parse_warnings.push(bombshell_css_core::Diagnostic::warning(
                    "selector-parse",
                    {
                        let mut message =
                            String::from("selector could not be matched at runtime: ");
                        message.push_str(&rule.selector);
                        message
                    },
                )),
            }
        }
        let index = RuleIndex::build(&rules);
        Stylesheet {
            origin: ir.origin,
            sheet_index,
            rules,
            layer_order: &ir.layer_order,
            index,
            parse_warnings,
        }
    }

    /// Rule indices that could possibly match `element`: the union of the
    /// element's own index keys plus the always-checked bucket, deduped,
    /// with impossible selectors filtered by an actual match attempt.
    pub(crate) fn matched_rules(
        &self,
        element: &crate::element::MatchElement,
        context: &mut crate::selectors::MatchContext,
    ) -> Vec<u32> {
        let node = element.node();
        let mut candidates: Vec<u32> = Vec::new();
        candidates.extend_from_slice(&self.index.universal);
        let push_key = |key: &str, candidates: &mut Vec<u32>| {
            if let Some(list) = self.index.keys.get(key) {
                candidates.extend_from_slice(list);
            }
        };
        push_key(node.tag.as_str(), &mut candidates);
        if let Some(id) = node.id.as_deref() {
            push_key(id, &mut candidates);
        }
        for class in &node.classes {
            push_key(class.as_str(), &mut candidates);
        }
        sort_by(&mut candidates, |a, b| a < b);
        candidates.dedup();
        candidates.retain(|&i| context.matches(element, &self.rules[i as usize].parsed));
        candidates
    }

    /// Selector text that failed to parse at load time.
    pub fn unmatched_selectors(&self) -> impl Iterator<Item = &str> {
        self.parse_warnings
            .iter()
            .map(|d| &d.message["selector could not be matched at runtime: ".len()..])
    }
}


/// Minimal stable sort. std's adaptive sort machinery is several KB of code;
/// cascade sorts are almost always a few dozen elements, where plain binary
/// insertion sort costs nothing and behaves identically.
fn sort_by<T>(v: &mut [T], mut less: impl FnMut(&T, &T) -> bool) {
    for i in 1..v.len() {
        // The element being inserted is `v[i]`; compare it against the
        // sorted prefix. Comparing `v[j]` instead would test the wrong pair
        // as soon as the key moves more than one slot.
        let mut j = i;
        while j > 0 && less(&v[i], &v[j - 1]) {
            j -= 1;
        }
        if j != i {
            v[j..=i].rotate_right(1);
        }
    }
}
/// The computed style of one element: winning declarations with inheritance
/// applied and `var()` references resolved. Names always borrow the IR;
/// values borrow until substitution produces something new.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ComputedStyle<'ir> {
    /// (property name, computed value), sorted by name. Names borrow the IR
    /// unless they came from an inline style.
    pub declarations: Vec<(Cow<'ir, str>, Cow<'ir, str>)>,
}

impl<'ir> ComputedStyle<'ir> {
    pub fn get(&self, name: &str) -> Option<&str> {
        self.declarations
            .iter()
            .find(|(n, _)| n.as_ref() == name)
            .map(|(_, v)| v.as_ref())
    }

    pub(crate) fn from_map(map: StyleMap<'ir>) -> ComputedStyle<'ir> {
        let mut declarations: Vec<(Cow<'ir, str>, Cow<'ir, str>)> = map.into_iter().collect();
        sort_by(&mut declarations, |a, b| a < b);
        ComputedStyle { declarations }
    }
}

/// Compute the style of `target` within `tree`.
///
/// The full ancestor chain is cascaded so container lookups, inheritance,
/// and style queries see computed values.
pub fn compute<'ir>(
    sheets: &[&Stylesheet<'ir>],
    tree: &TreeSnapshot,
    target: usize,
    env: &bombshell_css_core::Environment,
) -> Option<ComputedStyle<'ir>> {
    if target >= tree.nodes.len() {
        return None;
    }
    compute_tree(sheets, tree, env, std::slice::from_ref(&target))
        .into_iter()
        .nth(target)
        .flatten()
}

/// Compute styles for a whole tree in one pass: nodes are processed in
/// document order (parents before children), so each node's cascade runs
/// exactly once and every computed style is available to its descendants.
///
/// Returns one entry per node, index-aligned with `tree.nodes`; `targets`
/// restricts which entries are resolved (an empty list resolves every
/// node). Unresolved entries are empty styles.
pub fn compute_tree<'ir>(
    sheets: &[&Stylesheet<'ir>],
    tree: &TreeSnapshot,
    env: &bombshell_css_core::Environment,
    targets: &[usize],
) -> Vec<Option<ComputedStyle<'ir>>> {
    let count = tree.nodes.len();
    // Everything when `targets` is empty; otherwise each target plus its
    // ancestor chain (targets may not be leaves, so walk to the root).
    let mut wanted = vec![targets.is_empty(); count];
    for target in targets {
        let mut index = Some(*target);
        while let Some(current) = index {
            wanted[current] = true;
            index = tree.parent_of(current);
        }
    }

    // Resolved maps per node, kept so descendants can inherit computed
    // values; the sorted `ComputedStyle` form is built only for output.
    let mut maps: Vec<Option<StyleMap<'ir>>> = Vec::with_capacity(count);

    // `@layer` order is a document-wide property: layers rank by first
    // appearance across all sheets in cascade order. With a single sheet
    // this is exactly that sheet's own order — no allocation, and the
    // zero-allocation frame-loop claim holds for the common case.
    let merged: Vec<Vec<String>> = if sheets.len() == 1 {
        Vec::new()
    } else {
        let mut merged: Vec<Vec<String>> = Vec::new();
        for sheet in sheets {
            for path in sheet.layer_order {
                if !merged.iter().any(|existing| *existing == *path) {
                    merged.push(path.clone());
                }
            }
        }
        merged
    };
    let layers: &[Vec<String>] = if sheets.len() == 1 {
        sheets[0].layer_order
    } else {
        &merged
    };
    for index in 0..count {
        if !wanted[index] {
            maps.push(None);
            continue;
        }
        let parent = tree.parent_of(index);
        // Hosts list nodes in document order, so the parent is already
        // processed; a malformed ordering degrades to no inheritance rather
        // than panicking.
        let inherited: StyleMap<'ir> = match parent.and_then(|p| maps.get(p).and_then(|m| m.as_ref())) {
            Some(map) => map.clone(),
            None => HashMap::default(),
        };
        // Container ancestors: walk up through the already-computed maps.
        // The node itself is never its own container.
        let mut containers: Vec<ContainerAncestor> = Vec::new();
        let mut current = parent;
        while let Some(ancestor) = current {
            if let Some(map) = maps.get(ancestor).and_then(|m| m.as_ref()) {
                if let Some(container_type) = computed_container_type(map) {
                    let node = &tree.nodes[ancestor];
                    containers.push(ContainerAncestor {
                        name: map.get("container-name").map(|v| v.clone().into_owned()),
                        container_type,
                        width: node.width,
                        height: node.height,
                    });
                }
            }
            current = tree.parent_of(ancestor);
        }

        let mut map: StyleMap<'ir> = cascade(sheets, tree, index, env, &containers, layers);
        apply_css_wide_keywords(&mut map, &inherited);
        for (name, value) in &inherited {
            let inherits =
                name.starts_with("--") || INHERITED_PROPERTIES.iter().any(|p| *p == name.as_ref());
            if inherits && !map.contains_key(name) {
                map.insert(name.clone(), value.clone());
            }
        }
        // var() substitution is part of computing the value: descendants
        // inherit computed values, not raw `var()` text.
        resolve_vars_in_map(&mut map);
        // `light-dark()` resolves at computed-value time, after var()
        // substitution (a custom property may carry it into the using
        // declaration) and before descendants inherit the value.
        resolve_light_dark_in_map(&mut map, env.color_scheme);
        maps.push(Some(map));
    }

    maps.into_iter()
        .map(|slot| slot.map(ComputedStyle::from_map))
        .collect()
}

fn computed_container_type(map: &StyleMap<'_>) -> Option<ContainerType> {
    // `map.get` accepts `&str` via `Borrow<str>` on the `Cow` key.
    match map.get("container-type").map(|v| v.as_ref()) {
        Some("size") => Some(ContainerType::Size),
        Some("inline-size") => Some(ContainerType::InlineSize),
        Some("normal") | Some("") | None => None,
        Some(_) => None,
    }
}

/// Resolve var() references in every non-custom declaration (custom
/// properties keep their raw values until referenced).
fn resolve_vars_in_map(map: &mut StyleMap<'_>) {
    let names: Vec<Cow<'_, str>> = map.keys().cloned().collect();
    for name in names {
        if name.starts_with("--") {
            continue;
        }
        if let Some(value) = map.get(name.as_ref()) {
            if value.contains("var(") {
                match resolve_vars(value, map) {
                    Some(resolved) => {
                        map.insert(name, Cow::Owned(resolved));
                    }
                    None => {
                        // Invalid at computed-value time.
                        map.remove(name.as_ref());
                    }
                }
            }
        }
    }
}

/// Resolve `light-dark()` in every non-custom color declaration against the
/// environment's color scheme. Resolution is scoped to the color properties
/// the compiler canonicalizes; custom properties substitute verbatim and
/// resolve at the using declaration. A malformed call drops the
/// declaration, like a failed `var()` resolution.
fn resolve_light_dark_in_map(map: &mut StyleMap<'_>, scheme: bombshell_css_core::ColorScheme) {
    let names: Vec<Cow<'_, str>> = map.keys().cloned().collect();
    for name in names {
        if name.starts_with("--") {
            continue;
        }
        if !bombshell_css_core::is_color_property(name.as_ref()) {
            continue;
        }
        if let Some(value) = map.get(name.as_ref()) {
            if value.contains("light-dark(") {
                match resolve_light_dark(value, scheme) {
                    Some(resolved) => {
                        if resolved != value.as_ref() {
                            map.insert(name, Cow::Owned(resolved));
                        }
                    }
                    None => {
                        // Invalid at computed-value time.
                        map.remove(name.as_ref());
                    }
                }
            }
        }
    }
}

/// Handle `inherit`, `initial`, `unset`, and `revert` keywords.
fn apply_css_wide_keywords<'ir>(map: &mut StyleMap<'ir>, inherited: &StyleMap<'ir>) {
    let names: Vec<Cow<'ir, str>> = map.keys().cloned().collect();
    for name in names {
        let keyword = map.get(name.as_ref()).map(|v| v.trim()).unwrap_or_default();
        let inherits =
            name.starts_with("--") || INHERITED_PROPERTIES.iter().any(|p| *p == name.as_ref());
        match keyword {
            "inherit" => match inherited.get(name.as_ref()) {
                Some(value) => {
                    map.insert(name, value.clone());
                }
                None => {
                    map.remove(name.as_ref());
                }
            },
            "unset" => {
                if inherits {
                    match inherited.get(name.as_ref()) {
                        Some(value) => {
                            map.insert(name, value.clone());
                        }
                        None => {
                            map.remove(name.as_ref());
                        }
                    }
                } else {
                    map.remove(name.as_ref());
                }
            }
            // No initial-value table yet: `initial` and `revert` drop the
            // declaration.
            "initial" | "revert" => {
                map.remove(name.as_ref());
            }
            _ => {}
        }
    }
}

/// Cascade one node: condition-filtered, selector-matched rules, sorted by
/// origin/importance, layer, specificity, then source order; last write per
/// property wins. Inline style declarations slot in at their cascade
/// boundaries (see [`parse_inline_style`]).
fn cascade<'ir>(
    sheets: &[&Stylesheet<'ir>],
    tree: &TreeSnapshot,
    node_index: usize,
    env: &bombshell_css_core::Environment,
    containers: &[ContainerAncestor],
    layers: &[Vec<String>],
) -> StyleMap<'ir> {
    let Some(element) = crate::element::MatchElement::new(tree, node_index) else {
        return HashMap::default();
    };

    struct Candidate<'a> {
        declaration: &'a Declaration,
        origin_rank: u32,
        layer_rank: u32,
        specificity: u32,
        order: (usize, u32),
    }

    // One match context per element: the nth-index cache is per-element
    // state, not per-rule state.
    let mut context = crate::selectors::MatchContext::new();
    let mut candidates: Vec<Candidate> = Vec::new();
    for sheet in sheets {
        let mut matched = sheet.matched_rules(&element, &mut context);

        for rule_index in matched.drain(..) {
            let rule = &sheet.rules[rule_index as usize];
            if !eval_supports_list(rule.supports) {
                continue;
            }
            if !eval_media_list(rule.media, env) {
                continue;
            }
            if !eval_container_list(rule.containers, containers) {
                continue;
            }
            for declaration in rule.declarations {
                candidates.push(Candidate {
                    declaration,
                    origin_rank: origin_importance_rank(sheet.origin, declaration.important),
                    layer_rank: layer_rank(layers, rule.layer),
                    specificity: rule.specificity,
                    order: (sheet.sheet_index, rule.order),
                });
            }
        }
    }

    sort_by(&mut candidates, |a, b| {
        (a.origin_rank, a.layer_rank, a.specificity, a.order)
            < (b.origin_rank, b.layer_rank, b.specificity, b.order)
    });

    // Inline styles are author-origin declarations with precedence above
    // every stylesheet declaration of the same importance: inline-normal
    // slots in after all normal author rules, inline-`!important` after all
    // author-`!important` rules. Both still lose to higher tiers (user /
    // user-agent `!important`). Writing in ascending order means the last
    // write per property wins.
    let (inline_normal, inline_important) = tree.nodes[node_index]
        .style
        .as_deref()
        .map(parse_inline_style)
        .unwrap_or_default();

    // Ascending order: later candidates overwrite earlier ones, so the map
    // ends up holding the winning value per property.
    let mut winners: StyleMap<'ir> = HashMap::default();
    let mut inline_normal_pending = !inline_normal.is_empty();
    let mut inline_important_pending = !inline_important.is_empty();
    for candidate in &candidates {
        if inline_normal_pending && candidate.origin_rank >= 3 {
            for (name, value) in &inline_normal {
                winners.insert(Cow::Owned(name.clone()), Cow::Owned(value.clone()));
            }
            inline_normal_pending = false;
        }
        if inline_important_pending && candidate.origin_rank >= 4 {
            for (name, value) in &inline_important {
                winners.insert(Cow::Owned(name.clone()), Cow::Owned(value.clone()));
            }
            inline_important_pending = false;
        }
        let declaration = candidate.declaration;
        winners.insert(
            Cow::Borrowed(declaration.name.as_str()),
            Cow::Borrowed(declaration.value.as_str()),
        );
    }
    if inline_normal_pending {
        for (name, value) in &inline_normal {
            winners.insert(Cow::Owned(name.clone()), Cow::Owned(value.clone()));
        }
    }
    if inline_important_pending {
        for (name, value) in &inline_important {
            winners.insert(Cow::Owned(name.clone()), Cow::Owned(value.clone()));
        }
    }
    winners
}

/// `@layer` order across sheets: layers rank by first appearance across all
/// sheets in the order the host supplies them (later layers win). Unlayered
/// ranks above every layer.
fn layer_rank(layers: &[Vec<String>], layer: Option<&[String]>) -> u32 {
    match layer {
        None => u32::MAX,
        Some(path) => layers
            .iter()
            .position(|p| p.as_slice() == path)
            .map(|p| p as u32)
            .unwrap_or(u32::MAX - 1),
    }
}

/// Parse an inline `style` attribute into (normal, important) declaration
/// lists, in authorship order. Splits on `;` and the first `:` outside
/// parens, brackets, and quotes, so values like `url(data:image/png;base64,…)`
/// survive. Names are lowercased; values pass through un-canonicalized (the
/// compiler never sees them).
fn parse_inline_style(style: &str) -> (Vec<(String, String)>, Vec<(String, String)>) {
    let mut normal: Vec<(String, String)> = Vec::new();
    let mut important: Vec<(String, String)> = Vec::new();
    for part in top_level_split(style, ';') {
        let Some(sep) = top_level_index(part, ':') else {
            continue;
        };
        let name = part[..sep].trim().to_ascii_lowercase();
        let value = part[sep + 1..].trim();
        let Some((value, is_important)) = strip_important(value) else {
            continue;
        };
        if name.is_empty() || value.is_empty() {
            continue;
        }
        if is_important {
            important.push((name, value.to_string()));
        } else {
            normal.push((name, value.to_string()));
        }
    }
    (normal, important)
}

/// Strip a trailing case-insensitive `!important`; returns `None` when the
/// declaration is empty after trimming.
fn strip_important(value: &str) -> Option<(&str, bool)> {
    let lower = value.to_ascii_lowercase();
    if let Some(pos) = lower.rfind("!important") {
        if lower[pos + "!important".len()..].trim().is_empty() {
            let trimmed = value[..pos].trim_end();
            return Some((trimmed, true));
        }
    }
    (!value.is_empty()).then_some((value, false))
}

/// Split on every `sep` that sits outside parens, brackets, and quotes.
fn top_level_split(style: &str, sep: char) -> Vec<&str> {
    let mut out: Vec<&str> = Vec::new();
    let mut depth = 0usize;
    let mut quote: Option<char> = None;
    let mut start = 0usize;
    for (index, ch) in style.char_indices() {
        match ch {
            '(' | '[' if quote.is_none() => depth += 1,
            ')' | ']' if quote.is_none() => depth = depth.saturating_sub(1),
            '\'' | '"' if quote.is_none() => quote = Some(ch),
            c if Some(c) == quote => quote = None,
            _ => {}
        }
        if ch == sep && quote.is_none() && depth == 0 {
            out.push(&style[start..index]);
            start = index + ch.len_utf8();
        }
    }
    out.push(&style[start..]);
    out
}

/// Index of the first `sep` outside parens, brackets, and quotes.
fn top_level_index(style: &str, sep: char) -> Option<usize> {
    top_level_split(style, sep)
        .first()
        .map(|head| head.len())
        .filter(|&len| len < style.len())
}

/// Cascade priority within (origin, importance), ascending.
fn origin_importance_rank(origin: Origin, important: bool) -> u32 {
    match (origin, important) {
        (Origin::UserAgent, false) => 0,
        (Origin::User, false) => 1,
        (Origin::Author, false) => 2,
        (Origin::Author, true) => 3,
        (Origin::User, true) => 4,
        (Origin::UserAgent, true) => 5,
    }
}

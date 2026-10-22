//! Shared contracts for the Bombshell CSS pipeline.
//!
//! The IR/DOM-snapshot half is intentionally dependency-light (`serde` +
//! `postcard`, both `no_std`-capable). The selector engine lives here too,
//! behind the default `selectors` feature (which pulls `cssparser` and
//! `parcel_selectors`): both the compiler and the runtime drive this one
//! parser so they can never disagree about what a valid selector is.

#![cfg_attr(not(feature = "selectors"), no_std)]

extern crate alloc;

#[cfg(feature = "selectors")]
pub mod selectors;

#[cfg(feature = "selectors")]
pub mod tokens;

use alloc::{boxed::Box, string::String, vec::Vec};
use serde::{Deserialize, Serialize};

/// Version of the compiled stylesheet IR. Bump when the wire format changes
/// incompatibly; runtimes must reject unknown versions.
pub const IR_VERSION: u16 = 2;

/// The sentinel used in [`TreeSnapshot::parents`] for "no parent" (a root).
pub const NO_PARENT: u32 = u32::MAX;

/// Cascade origin of a stylesheet, mirroring the CSS cascade order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Origin {
    /// Rules from the user agent stylesheet.
    UserAgent,
    /// Rules supplied by the user.
    User,
    /// Rules supplied by the document/author.
    Author,
}

/// Severity of a [`Diagnostic`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Severity {
    /// A fatal or non-recoverable problem.
    Error,
    /// A recoverable problem worth reporting to authors.
    Warning,
}

/// A compile or runtime diagnostic. Messages are stable text; `code` is a
/// machine-readable identifier intended to grow over time.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Diagnostic {
    pub severity: Severity,
    pub code: String,
    pub message: String,
}

impl Diagnostic {
    pub fn error(code: &str, message: impl Into<String>) -> Self {
        Diagnostic {
            severity: Severity::Error,
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn warning(code: &str, message: impl Into<String>) -> Self {
        Diagnostic {
            severity: Severity::Warning,
            code: code.into(),
            message: message.into(),
        }
    }
}

/// A flat node snapshot describing one element of the host tree.
///
/// The host (tty/UI) ships the whole subtree it wants styled as a flat,
/// document-ordered node list plus a parent-index vector. This shape is
/// recursion-free (WIT-friendly) yet complete enough for structural
/// selectors, sibling combinators, `:has()` traversal, and container lookups.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct NodeSnapshot {
    /// Element tag name, e.g. `box`, `text`. Case-sensitive.
    pub tag: String,
    /// Element id, if any.
    pub id: Option<String>,
    /// Class names.
    pub classes: Vec<String>,
    /// Attributes, in source order. Lookup is case-sensitive on both name and value.
    pub attributes: Vec<(String, String)>,
    /// Element has keyboard focus.
    pub focus: bool,
    /// Pointer is over the element.
    pub hover: bool,
    /// Element is being activated.
    pub active: bool,
    /// Layout width in CSS px, if known. Satisfies container/media size queries.
    pub width: Option<f32>,
    /// Layout height in CSS px, if known.
    pub height: Option<f32>,
    /// Inline style declarations as authored (e.g. `color: red; --x: 1`).
    /// Parsed by the runtime cascade; author origin, above every stylesheet
    /// declaration of the same importance, below author-`!important` rules.
    pub style: Option<String>,
}

/// A flat tree snapshot: nodes in document order plus each node's parent index.
///
/// Nodes are in document order and siblings are contiguous runs that share a
/// parent. [`NO_PARENT`] marks roots.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TreeSnapshot {
    pub nodes: Vec<NodeSnapshot>,
    /// `parents[i]` is the index of the parent of node `i`, or [`NO_PARENT`].
    pub parents: Vec<u32>,
}

impl TreeSnapshot {
    pub fn parent_of(&self, index: usize) -> Option<usize> {
        self.parents
            .get(index)
            .and_then(|p| (*p != NO_PARENT).then_some(*p as usize))
    }

    pub fn children_of(&self, index: usize) -> impl Iterator<Item = usize> + '_ {
        self.parents
            .iter()
            .enumerate()
            .filter(move |&(_i, p)| *p == index as u32)
            .map(|(i, _)| i)
    }
}

/// Color scheme preference for `prefers-color-scheme`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ColorScheme {
    Light,
    Dark,
}

/// Rendering environment supplied with every `compute` call. Unknown
/// dimensions are `None`; queries involving unknown dimensions do not match.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Environment {
    pub viewport_width: Option<f32>,
    pub viewport_height: Option<f32>,
    pub color_scheme: ColorScheme,
    /// `true` when the user prefers reduced motion.
    pub reduced_motion: bool,
    /// Device pixel ratio.
    pub resolution: f32,
}

impl Default for Environment {
    fn default() -> Self {
        Environment {
            viewport_width: None,
            viewport_height: None,
            color_scheme: ColorScheme::Light,
            reduced_motion: false,
            resolution: 1.0,
        }
    }
}

// ---------------------------------------------------------------------------
// Compiled stylesheet IR
// ---------------------------------------------------------------------------

/// A compiled stylesheet: flattened, nesting-expanded rules with typed
/// condition trees, ready for linear-memory transport.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledStylesheet {
    /// [`IR_VERSION`] of the emitting compiler.
    pub version: u16,
    /// Origin this stylesheet was compiled for.
    pub origin: Origin,
    /// Cascade rules in source order.
    pub rules: Vec<CompiledRule>,
    /// Declared `@layer` names in first-appearance order. Nesting is a path.
    pub layer_order: Vec<Vec<String>>,
    /// Preserved `@keyframes` blocks (not yet evaluated at runtime).
    pub keyframes: Vec<KeyframesRule>,
    /// Preserved opaque at-rules (`@font-face`, `@property`, `@scope`, ...).
    pub opaque: Vec<OpaqueRule>,
    /// Warnings collected during compilation.
    pub warnings: Vec<Diagnostic>,
}

/// One flattened, nesting-expanded cascade rule.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledRule {
    /// Canonical serialized selector list (comma-separated).
    pub selector: String,
    /// Max specificity across the selector list, parcel_selectors-packed
    /// `(ids << 20) | (classes << 10) | elements`.
    pub specificity: u32,
    /// Layer path this rule lives in, if any.
    pub layer: Option<Vec<String>>,
    /// Media conditions. All must match.
    pub media: Vec<MediaCondition>,
    /// Container conditions. All must match.
    pub containers: Vec<ContainerQuery>,
    /// `@supports` conditions. All must match.
    pub supports: Vec<SupportsCondition>,
    /// Declarations, canonicalized per rule (each property at most once).
    pub declarations: Vec<Declaration>,
    /// Source order, unique within the originating stylesheet.
    pub order: u32,
}

/// A single declaration with its canonical value text.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Declaration {
    /// Canonical property name (kebab-case, or `--custom`).
    pub name: String,
    /// Canonical serialized value.
    pub value: String,
    /// Whether the declaration carried `!important`.
    pub important: bool,
}

/// A preserved `@keyframes` block.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct KeyframesRule {
    pub name: String,
    /// Canonical serialized body (everything inside the block).
    pub body: String,
}

/// A preserved opaque at-rule.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct OpaqueRule {
    /// Canonical serialized at-rule text.
    pub text: String,
}

/// Comparison operator for range features.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Compare {
    Equal,
    GreaterThan,
    GreaterThanEqual,
    LessThan,
    LessThanEqual,
}

/// A value appearing in a media/container feature.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum FeatureValue {
    /// Length already resolved to CSS px (absolute units).
    Px(f32),
    /// Length in a relative unit that needs a reference at evaluation time.
    RelativeLength {
        value: f32,
        unit: String,
    },
    Number(f32),
    Integer(i32),
    Boolean(bool),
    /// Resolution normalized to dppx.
    Dppx(f32),
    Ratio(f32, f32),
    Ident(String),
    /// Unrepresentable value; conditions using it never match.
    Unknown,
}

/// The evaluated shape of a media or container size feature.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum FeatureKind {
    /// `(width: 400px)` / `(min-width: 400px)`.
    Plain { value: FeatureValue },
    /// `(hover)` — presence test.
    Boolean,
    /// `(width > 400px)`.
    Range { cmp: Compare, value: FeatureValue },
    /// `(400px < width < 800px)`.
    Interval {
        start: FeatureValue,
        start_cmp: Compare,
        end: FeatureValue,
        end_cmp: Compare,
    },
}

/// A media or container size feature: canonical name plus its shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Feature {
    /// Canonical feature name (`min-width`, `width`, `aspect-ratio`, ...).
    pub name: String,
    pub kind: FeatureKind,
}

/// Boolean algebra over media features.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum MediaCondition {
    Feature(Feature),
    Not(Box<MediaCondition>),
    And(Vec<MediaCondition>),
    Or(Vec<MediaCondition>),
    /// Unparsed/unknown condition; never matches.
    Unknown,
}

/// A `@container` query: optional container name plus its condition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContainerQuery {
    /// Required container name, if the query was named.
    pub name: Option<String>,
    pub condition: ContainerCondition,
}

/// Boolean algebra over container conditions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ContainerCondition {
    /// Size feature (`width`, `inline-size`, `aspect-ratio`, ...).
    Size(Feature),
    /// Style query (`style(color: red)`), preserved as canonical text.
    Style {
        /// Canonical declaration text, e.g. `color: red`, or a bare property
        /// name to test for non-initial value.
        text: String,
    },
    Not(Box<ContainerCondition>),
    And(Vec<ContainerCondition>),
    Or(Vec<ContainerCondition>),
    /// Scroll-state or unknown conditions; never match (for now).
    Unknown,
}

/// `@supports` condition with leaves pre-evaluated at compile time.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SupportsCondition {
    /// Declaration support: `supported` was determined by the compiler.
    Declaration {
        name: String,
        value: String,
        supported: bool,
    },
    /// `selector(...)` support, validated at compile time.
    Selector {
        text: String,
        supported: bool,
    },
    Not(Box<SupportsCondition>),
    And(Vec<SupportsCondition>),
    Or(Vec<SupportsCondition>),
    Unknown,
}

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

/// IR decode failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IrError {
    /// Bytes are not valid postcard IR.
    Malformed,
    /// IR decoded but carries an unsupported [`IR_VERSION`].
    UnsupportedVersion(u16),
}

impl core::fmt::Display for IrError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            IrError::Malformed => f.write_str("malformed stylesheet IR"),
            IrError::UnsupportedVersion(v) => {
                write!(f, "unsupported IR version {v} (expected {IR_VERSION})")
            }
        }
    }
}

/// Encode a compiled stylesheet for linear-memory transport.
pub fn encode_ir(sheet: &CompiledStylesheet) -> Vec<u8> {
    postcard::to_allocvec(sheet).unwrap_or_default()
}

/// Decode and validate a compiled stylesheet.
pub fn decode_ir(bytes: &[u8]) -> Result<CompiledStylesheet, IrError> {
    let sheet: CompiledStylesheet = postcard::from_bytes(bytes).map_err(|_| IrError::Malformed)?;
    if sheet.version != IR_VERSION {
        return Err(IrError::UnsupportedVersion(sheet.version));
    }
    Ok(sheet)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    fn sample() -> CompiledStylesheet {
        CompiledStylesheet {
            version: IR_VERSION,
            origin: Origin::Author,
            rules: vec![CompiledRule {
                selector: ".card > .title".into(),
                specificity: 0x200020,
                layer: Some(vec!["base".into(), "typography".into()]),
                media: vec![MediaCondition::Feature(Feature {
                    name: "min-width".into(),
                    kind: FeatureKind::Plain {
                        value: FeatureValue::Px(384.0),
                    },
                })],
                containers: vec![ContainerQuery {
                    name: Some("panel".into()),
                    condition: ContainerCondition::Size(Feature {
                        name: "inline-size".into(),
                        kind: FeatureKind::Range {
                            cmp: Compare::GreaterThan,
                            value: FeatureValue::Px(720.0),
                        },
                    }),
                }],
                supports: vec![SupportsCondition::Declaration {
                    name: "color".into(),
                    value: "oklch(70% 0.2 40)".into(),
                    supported: true,
                }],
                declarations: vec![Declaration {
                    name: "color".into(),
                    value: "oklch(70% 0.2 40)".into(),
                    important: false,
                }],
                order: 3,
            }],
            layer_order: vec![
                vec!["base".into()],
                vec!["base".into(), "typography".into()],
            ],
            keyframes: vec![KeyframesRule {
                name: "pulse".into(),
                body: "0% {opacity:1} 100% {opacity:0}".into(),
            }],
            opaque: vec![OpaqueRule {
                text: "@font-face{font-family:x}".into(),
            }],
            warnings: vec![Diagnostic::warning("test", "sample warning")],
        }
    }

    #[test]
    fn round_trips() {
        let sheet = sample();
        let bytes = encode_ir(&sheet);
        let decoded = decode_ir(&bytes).unwrap();
        assert_eq!(decoded, sheet);
    }

    #[test]
    fn rejects_wrong_version() {
        let mut sheet = sample();
        sheet.version = 99;
        let bytes = encode_ir(&sheet);
        assert_eq!(decode_ir(&bytes), Err(IrError::UnsupportedVersion(99)));
    }
}

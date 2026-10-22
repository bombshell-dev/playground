//! Runtime evaluation of the typed IR condition trees against the
//! [`Environment`] and container snapshots.

use bombshell_css_core::{
    ColorScheme, Compare, ContainerCondition, ContainerQuery, Environment, Feature, FeatureKind,
    FeatureValue, MediaCondition,
};

/// A container discovered while walking the ancestor chain. Sizes come from
/// the node snapshot; container-ness comes from the ancestor's own computed
/// `container-type` / `container-name`.
#[derive(Debug, Clone)]
pub struct ContainerAncestor {
    /// The container's `container-name`, if set.
    pub name: Option<String>,
    /// Whether the container tracks inline size, block size, or both.
    pub container_type: ContainerType,
    pub width: Option<f32>,
    pub height: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContainerType {
    Normal,
    Size,
    InlineSize,
}

/// Evaluate a whole `@media` condition list (ANDed).
pub fn eval_media_list(conditions: &[MediaCondition], env: &Environment) -> bool {
    conditions.iter().all(|c| eval_media(c, env))
}

pub fn eval_media(condition: &MediaCondition, env: &Environment) -> bool {
    match condition {
        MediaCondition::And(conditions) => conditions.iter().all(|c| eval_media(c, env)),
        MediaCondition::Or(conditions) => conditions.iter().any(|c| eval_media(c, env)),
        MediaCondition::Not(inner) => !eval_media(inner, env),
        MediaCondition::Feature(feature) => eval_feature(feature, &FeatureSource::Viewport(env)),
        MediaCondition::Unknown => false,
    }
}

/// Evaluate a whole `@container` condition list (ANDed).
pub fn eval_container_list(queries: &[ContainerQuery], containers: &[ContainerAncestor]) -> bool {
    queries
        .iter()
        .all(|query| eval_container(query, containers))
}

pub fn eval_container(query: &ContainerQuery, containers: &[ContainerAncestor]) -> bool {
    let container = match &query.name {
        Some(name) => containers.iter().rev().find(|c| {
            c.container_type != ContainerType::Normal
                && c.name.as_deref().is_some_and(|n| n == name)
        }),
        None => containers
            .iter()
            .rev()
            .find(|c| c.container_type != ContainerType::Normal),
    };
    let Some(container) = container else {
        return false;
    };
    eval_container_condition(&query.condition, container)
}

fn eval_container_condition(condition: &ContainerCondition, container: &ContainerAncestor) -> bool {
    match condition {
        ContainerCondition::And(conditions) => conditions
            .iter()
            .all(|c| eval_container_condition(c, container)),
        ContainerCondition::Or(conditions) => conditions
            .iter()
            .any(|c| eval_container_condition(c, container)),
        ContainerCondition::Not(inner) => !eval_container_condition(inner, container),
        ContainerCondition::Size(feature) => {
            eval_feature(feature, &FeatureSource::Container(container))
        }
        ContainerCondition::Style { text } => {
            // Style queries are resolved against the container's computed
            // declarations by the cascade layer; without that context they
            // do not match.
            let _ = text;
            false
        }
        ContainerCondition::Unknown => false,
    }
}

pub enum FeatureSource<'a> {
    Viewport(&'a Environment),
    Container(&'a ContainerAncestor),
}

impl FeatureSource<'_> {
    fn dimension(&self, name: &str) -> Option<f32> {
        match self {
            FeatureSource::Viewport(env) => match name {
                "width" | "inline-size" => env.viewport_width,
                "height" | "block-size" => env.viewport_height,
                _ => None,
            },
            FeatureSource::Container(container) => {
                let (width, height) = (container.width, container.height);
                match name {
                    "width" => width,
                    "height" => height,
                    "inline-size" => match container.container_type {
                        // A `size` container has both axes; an `inline-size`
                        // container only guarantees the inline axis.
                        ContainerType::Normal => None,
                        ContainerType::InlineSize | ContainerType::Size => width,
                    },
                    "block-size" => match container.container_type {
                        ContainerType::Size => height,
                        _ => None,
                    },
                    _ => None,
                }
            }
        }
    }
}

/// Evaluate one media/container size feature.
pub fn eval_feature(feature: &Feature, source: &FeatureSource) -> bool {
    let name = feature.name.as_str();

    // Orientation and aspect-ratio need special handling.
    if let Some(result) = eval_special_feature(name, feature, source) {
        return result;
    }

    // Environment-driven features (prefers-*, color, hover, ...).
    if let FeatureSource::Viewport(env) = source {
        if let Some(result) = eval_env_feature(name, feature, env) {
            return result;
        }
    }

    // Dimensional features.
    match &feature.kind {
        FeatureKind::Boolean => {
            // `(width)` is true when the dimension is known and non-zero.
            source.dimension(name).is_some_and(|v| v != 0.0)
        }
        FeatureKind::Plain { value } => {
            let Some(dimension) = source.dimension(name) else {
                return false;
            };
            let Some(actual) = feature_value(value, source) else {
                return false;
            };
            compare(Compare::Equal, dimension, actual)
        }
        FeatureKind::Range { cmp, value } => {
            let Some(dimension) = source.dimension(name) else {
                return false;
            };
            let Some(actual) = feature_value(value, source) else {
                return false;
            };
            compare(*cmp, dimension, actual)
        }
        FeatureKind::Interval {
            start,
            start_cmp,
            end,
            end_cmp,
        } => {
            let Some(dimension) = source.dimension(name) else {
                return false;
            };
            let (Some(start), Some(end)) =
                (feature_value(start, source), feature_value(end, source))
            else {
                return false;
            };
            // `(a < feature < b)`: the start operator is written between the
            // start value and the feature (feature on the right), the end
            // operator between the feature and the end value.
            compare(*start_cmp, start, dimension) && compare(*end_cmp, dimension, end)
        }
    }
}

/// Orientation and aspect-ratio need special handling.
fn eval_special_feature(name: &str, feature: &Feature, source: &FeatureSource) -> Option<bool> {
    if name == "orientation" {
        let (width, height) = match source {
            FeatureSource::Viewport(env) => (env.viewport_width, env.viewport_height),
            FeatureSource::Container(c) => (c.width, c.height),
        };
        let (Some(width), Some(height)) = (width, height) else {
            return Some(false);
        };
        let landscape = width > height;
        return Some(match &feature.kind {
            FeatureKind::Boolean => true,
            FeatureKind::Plain {
                value: FeatureValue::Ident(ident),
            } => match ident.as_str() {
                "landscape" => landscape,
                "portrait" => !landscape,
                _ => false,
            },
            _ => false,
        });
    }
    if name == "aspect-ratio" {
        let (width, height) = match source {
            FeatureSource::Viewport(env) => (env.viewport_width, env.viewport_height),
            FeatureSource::Container(c) => (c.width, c.height),
        };
        let (Some(width), Some(height)) = (width, height) else {
            return Some(false);
        };
        let actual = width / height.max(f32::EPSILON);
        return Some(match &feature.kind {
            FeatureKind::Boolean => true,
            FeatureKind::Plain { value } => match feature_value(value, source) {
                Some(ratio) => (actual - ratio).abs() < f32::EPSILON,
                None => false,
            },
            FeatureKind::Range { cmp, value } => match feature_value(value, source) {
                Some(ratio) => compare(*cmp, actual, ratio),
                None => false,
            },
            FeatureKind::Interval {
                start,
                start_cmp,
                end,
                end_cmp,
            } => {
                let (Some(start), Some(end)) =
                    (feature_value(start, source), feature_value(end, source))
                else {
                    return Some(false);
                };
                compare(*start_cmp, actual, start) && compare(*end_cmp, actual, end)
            }
        });
    }
    None
}

/// Environment-driven features that are not plain dimension comparisons.
fn eval_env_feature(name: &str, feature: &Feature, env: &Environment) -> Option<bool> {
    match name {
        "prefers-color-scheme" => Some(match &feature.kind {
            FeatureKind::Boolean => true,
            FeatureKind::Plain {
                value: FeatureValue::Ident(ident),
            } => match ident.as_str() {
                "light" => env.color_scheme == ColorScheme::Light,
                "dark" => env.color_scheme == ColorScheme::Dark,
                _ => false,
            },
            _ => false,
        }),
        "prefers-reduced-motion" => Some(match &feature.kind {
            FeatureKind::Boolean => true,
            FeatureKind::Plain {
                value: FeatureValue::Ident(ident),
            } => match ident.as_str() {
                "reduce" => env.reduced_motion,
                "no-preference" => !env.reduced_motion,
                _ => false,
            },
            _ => false,
        }),
        "resolution"
        | "device-pixel-ratio"
        | "min-device-pixel-ratio"
        | "max-device-pixel-ratio" => {
            let dppx = match &feature.kind {
                FeatureKind::Plain { value } => feature_value(value, &FeatureSource::Viewport(env)),
                FeatureKind::Range { cmp, value } => {
                    return Some(match feature_value(value, &FeatureSource::Viewport(env)) {
                        Some(actual) => compare(*cmp, env.resolution, actual),
                        None => false,
                    });
                }
                FeatureKind::Boolean => return Some(true),
                FeatureKind::Interval { .. } => return Some(false),
            };
            Some(match dppx {
                Some(actual) => (env.resolution - actual).abs() < f32::EPSILON,
                None => false,
            })
        }
        "color" => Some(true),
        "color-index" | "monochrome" | "grid" => Some(match &feature.kind {
            FeatureKind::Boolean => false,
            FeatureKind::Plain { value } => {
                match feature_value(value, &FeatureSource::Viewport(env)) {
                    Some(actual) => actual == 0.0,
                    None => false,
                }
            }
            _ => false,
        }),
        "hover" | "any-hover" | "pointer" | "any-pointer" => Some(match &feature.kind {
            FeatureKind::Boolean => false,
            FeatureKind::Plain {
                value: FeatureValue::Ident(ident),
            } => matches!(ident.as_str(), "none"),
            _ => false,
        }),
        "color-gamut" => Some(match &feature.kind {
            FeatureKind::Plain {
                value: FeatureValue::Ident(ident),
            } => matches!(ident.as_str(), "srgb"),
            _ => false,
        }),
        "scripting" => Some(match &feature.kind {
            FeatureKind::Boolean => true,
            FeatureKind::Plain {
                value: FeatureValue::Ident(ident),
            } => matches!(ident.as_str(), "enabled" | "initial-only"),
            _ => false,
        }),
        "update"
        | "overflow-block"
        | "overflow-inline"
        | "dynamic-range"
        | "video-dynamic-range"
        | "prefers-contrast"
        | "forced-colors"
        | "prefers-transparency"
        | "inverted-colors" => Some(match &feature.kind {
            FeatureKind::Boolean => false,
            _ => false,
        }),
        _ => None,
    }
}

fn feature_value(value: &FeatureValue, source: &FeatureSource) -> Option<f32> {
    match value {
        FeatureValue::Px(px) => Some(*px),
        FeatureValue::RelativeLength { value, unit } => {
            let base = match source {
                // Media queries resolve em/rem against the root font size.
                FeatureSource::Viewport(_) => 16.0,
                // Container queries resolve against the container's font
                // size, which the terminal model does not carry yet.
                FeatureSource::Container(_) => 16.0,
            };
            match unit.as_str() {
                "em" | "rem" => Some(value * base),
                "ch" | "ex" => Some(value * 8.0),
                "vw" => match source {
                    FeatureSource::Viewport(env) => env.viewport_width.map(|w| value * w / 100.0),
                    FeatureSource::Container(_) => None,
                },
                "vh" => match source {
                    FeatureSource::Viewport(env) => env.viewport_height.map(|h| value * h / 100.0),
                    FeatureSource::Container(_) => None,
                },
                "cqw" | "cqi" => match source {
                    FeatureSource::Container(c) => c.width.map(|w| value * w / 100.0),
                    FeatureSource::Viewport(_) => None,
                },
                "cqh" | "cqb" => match source {
                    FeatureSource::Container(c) => c.height.map(|h| value * h / 100.0),
                    FeatureSource::Viewport(_) => None,
                },
                _ => None,
            }
        }
        FeatureValue::Number(n) => Some(*n),
        FeatureValue::Integer(i) => Some(*i as f32),
        FeatureValue::Boolean(b) => Some((*b as i32) as f32),
        FeatureValue::Dppx(d) => Some(*d),
        FeatureValue::Ratio(numerator, denominator) => {
            if *denominator == 0.0 {
                None
            } else {
                Some(numerator / denominator)
            }
        }
        FeatureValue::Ident(_) => None,
        FeatureValue::Unknown => None,
    }
}

fn compare(cmp: Compare, actual: f32, expected: f32) -> bool {
    match cmp {
        Compare::Equal => (actual - expected).abs() < f32::EPSILON,
        Compare::GreaterThan => actual > expected,
        Compare::GreaterThanEqual => actual >= expected,
        Compare::LessThan => actual < expected,
        Compare::LessThanEqual => actual <= expected,
    }
}

/// Evaluate a `@supports` condition (leaves were pre-evaluated by the
/// compiler).
pub fn eval_supports_list(conditions: &[bombshell_css_core::SupportsCondition]) -> bool {
    conditions.iter().all(eval_supports)
}

pub fn eval_supports(condition: &bombshell_css_core::SupportsCondition) -> bool {
    use bombshell_css_core::SupportsCondition as C;
    match condition {
        C::And(conditions) => conditions.iter().all(eval_supports),
        C::Or(conditions) => conditions.iter().any(eval_supports),
        C::Not(inner) => !eval_supports(inner),
        C::Declaration { supported, .. } => *supported,
        C::Selector { supported, .. } => *supported,
        C::Unknown => false,
    }
}

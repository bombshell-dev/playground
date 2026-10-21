//! Parsing of raw at-rule preludes (`@media`, `@container`, `@supports`)
//! into the typed IR condition trees consumed by the runtime.
//!
//! The shim captures preludes as raw source text; this module re-tokenizes
//! them with `cssparser` and builds the same shapes lightningcss's typed AST
//! used to produce: legacy `min-*`/`max-*` names canonicalize into ranges,
//! interval comparisons stay as-written (the feature sits on the right of
//! the first operator), discrete feature values lowercase, and `@supports`
//! leaves are pre-evaluated at compile time.

use bombshell_css_core::{
    Compare, ContainerCondition, Feature, FeatureKind, FeatureValue, MediaCondition,
    SupportsCondition,
};
use bombshell_css_core::tokens::write_token;
use cssparser::{Parser as CssParser, ParserInput, Token};

use bombshell_css_core::selectors::validate_and_specificity;
use crate::known_properties::is_known_property;

// ---------------------------------------------------------------------------
// @media
// ---------------------------------------------------------------------------

/// Parse a whole `@media` prelude. Comma-separated queries are ORs.
pub(crate) fn parse_media_prelude(text: &str) -> MediaCondition {
    let mut input = ParserInput::new(text);
    let mut parser = CssParser::new(&mut input);

    let mut branches: Vec<MediaCondition> = Vec::new();
    let mut current: Vec<MediaCondition> = Vec::new();

    loop {
        match parser.next_including_whitespace() {
            Ok(Token::Comma) => {
                if !current.is_empty() {
                    branches.push(and_all(std::mem::take(&mut current)));
                }
            }
            Ok(Token::Comment(_) | Token::WhiteSpace(_)) => {}
            // A leading group is its own query (`(a) and (b)`, comma lists):
            // dispatch it directly, then let the query parser read the rest.
            Ok(Token::ParenthesisBlock) => {
                current.push(parse_media_in_parens(&mut parser));
            }
            Ok(_) => match parse_media_query(&mut parser) {
                Some(condition) => current.push(condition),
                None => current.push(MediaCondition::Unknown),
            },
            Err(_) => break,
        }
    }

    if !current.is_empty() {
        branches.push(and_all(current));
    }

    match branches.len() {
        0 => MediaCondition::And(vec![]),
        1 => branches.into_iter().next().unwrap(),
        _ => MediaCondition::Or(branches),
    }
}

/// One comma-separated media query: `[only | not]? type? [and group]*`.
fn parse_media_query(parser: &mut CssParser<'_, '_>) -> Option<MediaCondition> {
    let mut conjuncts: Vec<MediaCondition> = Vec::new();
    let mut qualifier_not = false;

    loop {
        match parser.next_including_whitespace() {
            Ok(Token::Comment(_) | Token::WhiteSpace(_)) => {}
            Ok(Token::Comma) => break,
            Ok(Token::Ident(name)) => {
                let name = name.to_ascii_lowercase();
                match name.as_str() {
                    "only" => {}
                    "not" if conjuncts.is_empty() => qualifier_not = true,
                    "and" | "or" => {}
                    type_name => {
                        // Media type: the terminal target is a screen-like
                        // device.
                        let matches = matches!(type_name, "all" | "screen");
                        if !matches {
                            conjuncts
                                .push(MediaCondition::Not(Box::new(MediaCondition::And(vec![]))));
                        }
                    }
                }
            }
            Ok(Token::ParenthesisBlock) => {
                conjuncts.push(parse_media_in_parens(parser));
            }
            Ok(_) => return None,
            Err(_) => break,
        }
    }

    let combined = match conjuncts.len() {
        0 => MediaCondition::And(vec![]),
        1 => conjuncts.into_iter().next().unwrap(),
        _ => MediaCondition::And(conjuncts),
    };
    Some(if qualifier_not {
        MediaCondition::Not(Box::new(combined))
    } else {
        combined
    })
}

/// The contents of one `(...)` media group: either a single feature or
/// nested `and`/`or`/`not` algebra.
fn parse_media_in_parens(parser: &mut CssParser<'_, '_>) -> MediaCondition {
    let text = capture_nested_text(parser);

    if let Some(feature) = parse_feature_text(&text) {
        return MediaCondition::Feature(feature);
    }

    let mut input = ParserInput::new(&text);
    let mut inner = CssParser::new(&mut input);

    let mut operands: Vec<MediaCondition> = Vec::new();
    let mut operator: Option<&'static str> = None;
    let mut negate = false;

    loop {
        match inner.next_including_whitespace() {
            Ok(Token::Comment(_) | Token::WhiteSpace(_)) => {}
            Ok(Token::Ident(name)) => {
                let name = name.to_ascii_lowercase();
                match name.as_str() {
                    "not" => negate = true,
                    "and" | "or" => {
                        let op: &'static str = if name == "and" { "and" } else { "or" };
                        match operator {
                            None => operator = Some(op),
                            Some(existing) if existing == op => {}
                            // Mixed and/or at one level is invalid.
                            Some(_) => return MediaCondition::Unknown,
                        }
                    }
                    _ => return MediaCondition::Unknown,
                }
            }
            Ok(Token::ParenthesisBlock) => {
                operands.push(parse_media_in_parens(&mut inner));
            }
            Ok(_) => return MediaCondition::Unknown,
            Err(_) => break,
        }
    }

    let combined = match operands.len() {
        0 => MediaCondition::And(vec![]),
        1 => operands.into_iter().next().unwrap(),
        _ => match operator {
            Some("or") => MediaCondition::Or(operands),
            _ => MediaCondition::And(operands),
        },
    };

    if negate {
        MediaCondition::Not(Box::new(combined))
    } else {
        combined
    }
}

// ---------------------------------------------------------------------------
// @container
// ---------------------------------------------------------------------------

/// Parse a `@container` prelude: `[container-name]? condition`.
pub(crate) fn parse_container_prelude(text: &str) -> (Option<String>, ContainerCondition) {
    let mut input = ParserInput::new(text);
    let mut parser = CssParser::new(&mut input);

    let mut name: Option<String> = None;

    loop {
        match parser.next_including_whitespace() {
            Ok(Token::Comment(_) | Token::WhiteSpace(_)) => {}
            Ok(Token::Ident(ident)) => name = Some(ident.to_string()),
            Ok(Token::ParenthesisBlock) => {
                return (name, parse_container_in_parens(&mut parser));
            }
            Ok(Token::Function(fn_name)) => {
                let lower = fn_name.to_ascii_lowercase();
                let condition = match lower.as_str() {
                    "style" => ContainerCondition::Style {
                        text: capture_nested_text(&mut parser),
                    },
                    "scroll-state" => {
                        consume_nested(&mut parser);
                        ContainerCondition::Unknown
                    }
                    "not" => {
                        ContainerCondition::Not(Box::new(parse_container_in_parens(&mut parser)))
                    }
                    _ => ContainerCondition::Unknown,
                };
                return (name, condition);
            }
            Ok(_) | Err(_) => return (name, ContainerCondition::And(vec![])),
        }
    }
}

/// The contents of one `(...)` container group: a size feature, or nested
/// `and`/`or`/`not` algebra (including `style(...)` operands).
fn parse_container_in_parens(parser: &mut CssParser<'_, '_>) -> ContainerCondition {
    let text = capture_nested_text(parser);

    if let Some(feature) = parse_feature_text(&text) {
        return ContainerCondition::Size(feature);
    }

    let mut input = ParserInput::new(&text);
    let mut inner = CssParser::new(&mut input);

    let mut operands: Vec<ContainerCondition> = Vec::new();
    let mut operator: Option<&'static str> = None;
    let mut negate = false;

    loop {
        match inner.next_including_whitespace() {
            Ok(Token::Comment(_) | Token::WhiteSpace(_)) => {}
            Ok(Token::Ident(name)) => {
                let name = name.to_ascii_lowercase();
                match name.as_str() {
                    "not" => negate = true,
                    "and" | "or" => {
                        let op: &'static str = if name == "and" { "and" } else { "or" };
                        match operator {
                            None => operator = Some(op),
                            Some(existing) if existing == op => {}
                            Some(_) => return ContainerCondition::Unknown,
                        }
                    }
                    _ => return ContainerCondition::Unknown,
                }
            }
            Ok(Token::ParenthesisBlock) => {
                operands.push(parse_container_in_parens(&mut inner));
            }
            Ok(Token::Function(fn_name)) => {
                let lower = fn_name.to_ascii_lowercase();
                match lower.as_str() {
                    "style" => operands.push(ContainerCondition::Style {
                        text: capture_nested_text(&mut inner),
                    }),
                    "scroll-state" => {
                        consume_nested(&mut inner);
                        operands.push(ContainerCondition::Unknown);
                    }
                    "not" => {
                        let inner_condition = parse_container_in_parens(&mut inner);
                        operands.push(ContainerCondition::Not(Box::new(inner_condition)));
                    }
                    _ => return ContainerCondition::Unknown,
                }
            }
            Ok(_) => return ContainerCondition::Unknown,
            Err(_) => break,
        }
    }

    let combined = match operands.len() {
        0 => ContainerCondition::And(vec![]),
        1 => operands.into_iter().next().unwrap(),
        _ => match operator {
            Some("or") => ContainerCondition::Or(operands),
            _ => ContainerCondition::And(operands),
        },
    };

    if negate {
        ContainerCondition::Not(Box::new(combined))
    } else {
        combined
    }
}

// ---------------------------------------------------------------------------
// @supports
// ---------------------------------------------------------------------------

/// Parse a `@supports` prelude.
pub(crate) fn parse_supports_prelude(text: &str) -> SupportsCondition {
    let mut input = ParserInput::new(text);
    let mut parser = CssParser::new(&mut input);

    parse_supports_algebra(&mut parser)
}

/// Boolean algebra at one level over supports operands.
fn parse_supports_algebra(parser: &mut CssParser<'_, '_>) -> SupportsCondition {
    let mut operands: Vec<SupportsCondition> = Vec::new();
    let mut operator: Option<&'static str> = None;
    let mut negate = false;

    loop {
        match parser.next_including_whitespace() {
            Ok(Token::Comment(_) | Token::WhiteSpace(_)) => {}
            Ok(Token::Ident(name)) => {
                let name = name.to_ascii_lowercase();
                match name.as_str() {
                    "not" => negate = true,
                    "and" | "or" => {
                        let op: &'static str = if name == "and" { "and" } else { "or" };
                        match operator {
                            None => operator = Some(op),
                            Some(existing) if existing == op => {}
                            Some(_) => return SupportsCondition::Unknown,
                        }
                    }
                    _ => return SupportsCondition::Unknown,
                }
            }
            Ok(Token::ParenthesisBlock) => {
                operands.push(parse_supports_in_parens(parser));
            }
            Ok(Token::Function(fn_name)) => {
                let lower = fn_name.to_ascii_lowercase();
                match lower.as_str() {
                    "selector" => {
                        let inner_text = capture_nested_text(parser);
                        let supported =
                            validate_and_specificity(inner_text.trim()).is_ok();
                        operands.push(SupportsCondition::Selector {
                            text: inner_text,
                            supported,
                        });
                    }
                    _ => return SupportsCondition::Unknown,
                }
            }
            Ok(_) => return SupportsCondition::Unknown,
            Err(_) => break,
        }
    }

    let combined = match operands.len() {
        0 => SupportsCondition::And(vec![]),
        1 => operands.into_iter().next().unwrap(),
        _ => match operator {
            Some("or") => SupportsCondition::Or(operands),
            _ => SupportsCondition::And(operands),
        },
    };

    if negate {
        SupportsCondition::Not(Box::new(combined))
    } else {
        combined
    }
}

/// One `(...)` supports group: either a declaration test or nested algebra.
fn parse_supports_in_parens(parser: &mut CssParser<'_, '_>) -> SupportsCondition {
    let text = capture_nested_text(parser);
    let trimmed = text.trim();

    // Declaration form: `name: value`.
    let mut input = ParserInput::new(trimmed);
    let mut inner = CssParser::new(&mut input);
    let is_declaration = inner
        .try_parse(|parser| -> Result<(), cssparser::ParseError<'_, ()>> {
            match parser.next() {
                Ok(Token::Ident(_)) => {}
                Ok(_) => return Err(custom_err(parser)),
                Err(_) => return Err(custom_err(parser)),
            }
            match parser.next() {
                Ok(Token::Colon) => {}
                Ok(_) => return Err(custom_err(parser)),
                Err(_) => return Err(custom_err(parser)),
            }
            Ok(())
        })
        .is_ok();

    if is_declaration {
        if let Some((name, value)) = trimmed.split_once(':') {
            let value = value.trim().to_string();
            let name = name.trim().to_ascii_lowercase();
            let supported = is_known_property(&name) || name.starts_with("--");
            return SupportsCondition::Declaration {
                name,
                value,
                supported,
            };
        }
    }

    // Nested algebra.
    let mut input = ParserInput::new(trimmed);
    let mut inner = CssParser::new(&mut input);
    parse_supports_algebra(&mut inner)
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

/// Try to read one captured `(...)` group as a media/container size feature.
fn parse_feature_text(text: &str) -> Option<Feature> {
    let mut input = ParserInput::new(text);
    let mut parser = CssParser::new(&mut input);

    parser.try_parse(parse_feature_block).ok()
}

fn parse_feature_block<'i, 'tt>(
    parser: &mut CssParser<'i, 'tt>,
) -> Result<Feature, cssparser::ParseError<'i, ()>> {
    let pieces = collect_feature_pieces(parser)?;
    build_feature(pieces).map_err(|()| custom_err(parser))
}

#[derive(Debug, Clone)]
enum Piece {
    Name(String),
    Op(Compare),
    Colon,
    Value(FeatureValue),
}

fn collect_feature_pieces<'i, 'tt>(
    parser: &mut CssParser<'i, 'tt>,
) -> Result<Vec<Piece>, cssparser::ParseError<'i, ()>> {
    let mut pieces: Vec<Piece> = Vec::new();
    let mut name_seen = false;

    // The captured group text is the inner content: read to the end.
    loop {
        match parser.next_including_whitespace() {
            Ok(Token::Comment(_) | Token::WhiteSpace(_)) => {}
            Ok(Token::Ident(name)) => {
                // The feature name comes first; later identifiers are
                // discrete values (`(prefers-color-scheme: dark)`).
                if name_seen {
                    pieces.push(Piece::Value(FeatureValue::Ident(name.to_ascii_lowercase())));
                } else {
                    pieces.push(Piece::Name(name.to_string()));
                    name_seen = true;
                }
            }
            Ok(Token::Delim(op @ ('<' | '>' | '='))) => {
                let mut cmp = match op {
                    '<' => Compare::LessThan,
                    '>' => Compare::GreaterThan,
                    _ => Compare::Equal,
                };
                // Optional `=`.
                if let Ok(Token::Delim('=')) = parser.next_including_whitespace() {
                    if cmp != Compare::Equal {
                        cmp = match cmp {
                            Compare::LessThan => Compare::LessThanEqual,
                            Compare::GreaterThan => Compare::GreaterThanEqual,
                            _ => cmp,
                        };
                    }
                }
                pieces.push(Piece::Op(cmp));
            }
            Ok(Token::Colon) => pieces.push(Piece::Colon),
            Ok(
                token @ (Token::Number { .. } | Token::Percentage { .. } | Token::Dimension { .. }),
            ) => {
                pieces.push(Piece::Value(media_value(token)));
            }
            Ok(_) => return Err(custom_err(parser)),
            Err(_) => break,
        }
    }

    Ok(pieces)
}

/// Strictly validate the piece sequence into the IR feature shape.
fn build_feature(pieces: Vec<Piece>) -> Result<Feature, ()> {
    let names: Vec<usize> = pieces
        .iter()
        .enumerate()
        .filter(|(_, p)| matches!(p, Piece::Name(_)))
        .map(|(i, _)| i)
        .collect();
    let ops: Vec<usize> = pieces
        .iter()
        .enumerate()
        .filter(|(_, p)| matches!(p, Piece::Op(_)))
        .map(|(i, _)| i)
        .collect();

    match (names.len(), ops.len()) {
        // Boolean presence test: `(hover)`.
        (1, 0) if pieces.len() == 1 => Ok(Feature {
            name: canonical_name(&pieces, names[0]),
            kind: FeatureKind::Boolean,
        }),
        // Plain with colon: `(min-width: 24em)`, `(prefers-color-scheme: dark)`,
        // `(aspect-ratio: 16/9)`.
        (1, 0) if pieces.len() >= 3 && matches!(&pieces[1], Piece::Colon) => {
            let value = take_value(&pieces[2..]).ok_or(())?;
            normalize(Feature {
                name: canonical_name(&pieces, names[0]),
                kind: FeatureKind::Plain { value },
            })
        }
        // Range with the feature on the left: `(width > 400px)`.
        (1, 1) if names[0] == 0 && ops[0] == 1 && pieces.len() == 3 => {
            let Piece::Op(cmp) = pieces[ops[0]].clone() else {
                return Err(());
            };
            let value = take_value(&pieces[2..]).ok_or(())?;
            normalize(Feature {
                name: canonical_name(&pieces, names[0]),
                kind: FeatureKind::Range { cmp, value },
            })
        }
        // Range with the feature on the right: `(400px < width)`.
        (1, 1) if ops[0] == 1 && pieces.len() == 3 => {
            let Piece::Op(cmp) = pieces[ops[0]].clone() else {
                return Err(());
            };
            let value = take_value(&pieces[..1]).ok_or(())?;
            normalize(Feature {
                name: canonical_name(&pieces, names[0]),
                kind: FeatureKind::Range {
                    cmp: mirror(cmp),
                    value,
                },
            })
        }
        // Interval: `(400px < width < 800px)`. Comparisons stay as-written;
        // the runtime evaluates `start op dimension`, then `dimension op end`.
        (1, 2) if ops[0] == 1 && names[0] == 2 && ops[1] == 3 && pieces.len() == 5 => {
            let (Piece::Op(start_cmp), Piece::Op(end_cmp)) =
                (pieces[ops[0]].clone(), pieces[ops[1]].clone())
            else {
                return Err(());
            };
            let start = take_value(&pieces[..1]).ok_or(())?;
            let end = take_value(&pieces[4..]).ok_or(())?;
            Ok(Feature {
                name: canonical_name(&pieces, names[0]),
                kind: FeatureKind::Interval {
                    start,
                    start_cmp,
                    end,
                    end_cmp,
                },
            })
        }
        _ => Err(()),
    }
}

/// Consume one value (with an optional ratio slash) from the pieces.
fn take_value(pieces: &[Piece]) -> Option<FeatureValue> {
    let mut iter = pieces.iter();
    let first = match iter.next()? {
        Piece::Value(v) => v.clone(),
        _ => return None,
    };

    match iter.next() {
        None => Some(first),
        Some(Piece::Value(second)) => ratio_of(first, second.clone()),
        Some(_) => None,
    }
}

fn ratio_of(first: FeatureValue, second: FeatureValue) -> Option<FeatureValue> {
    let numerator = match first {
        FeatureValue::Integer(a) => a as f32,
        FeatureValue::Number(a) => a,
        _ => return None,
    };
    let denominator = match second {
        FeatureValue::Integer(b) => b as f32,
        FeatureValue::Number(b) => b,
        _ => return None,
    };
    Some(FeatureValue::Ratio(numerator, denominator))
}

fn canonical_name(pieces: &[Piece], index: usize) -> String {
    match &pieces[index] {
        Piece::Name(name) => name.to_ascii_lowercase(),
        _ => String::new(),
    }
}

/// Legacy `min-*`/`max-*` names become equivalent range shapes.
fn normalize(feature: Feature) -> Result<Feature, ()> {
    if let FeatureKind::Plain { value } = &feature.kind {
        if let Some(base) = feature.name.strip_prefix("min-") {
            return Ok(Feature {
                name: base.to_string(),
                kind: FeatureKind::Range {
                    cmp: Compare::GreaterThanEqual,
                    value: value.clone(),
                },
            });
        }
        if let Some(base) = feature.name.strip_prefix("max-") {
            return Ok(Feature {
                name: base.to_string(),
                kind: FeatureKind::Range {
                    cmp: Compare::LessThanEqual,
                    value: value.clone(),
                },
            });
        }
    }
    Ok(feature)
}

fn mirror(cmp: Compare) -> Compare {
    match cmp {
        Compare::LessThan => Compare::GreaterThan,
        Compare::LessThanEqual => Compare::GreaterThanEqual,
        Compare::GreaterThan => Compare::LessThan,
        Compare::GreaterThanEqual => Compare::LessThanEqual,
        Compare::Equal => Compare::Equal,
    }
}

/// Convert a value token into the IR feature value.
fn media_value(token: &Token<'_>) -> FeatureValue {
    match token {
        Token::Number {
            value, int_value, ..
        } => match int_value {
            Some(int) => FeatureValue::Integer(*int),
            None => FeatureValue::Number(*value),
        },
        Token::Percentage { .. } => FeatureValue::Unknown,
        Token::Dimension { value, unit, .. } => {
            let unit_lower = unit.to_ascii_lowercase();
            match unit_lower.as_str() {
                "px" => FeatureValue::Px(*value),
                "dpi" | "dpcm" | "dppx" | "x" => {
                    let v = *value;
                    FeatureValue::Dppx(match unit_lower.as_str() {
                        "dpi" => v / 96.0,
                        "dpcm" => v * 2.54 / 96.0,
                        _ => v,
                    })
                }
                other => FeatureValue::RelativeLength {
                    value: *value,
                    unit: other.to_string(),
                },
            }
        }
        Token::Ident(ident) => FeatureValue::Ident(ident.to_ascii_lowercase()),
        _ => FeatureValue::Unknown,
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Consume the current nested block and return its text, recursing into
/// nested blocks so nothing is lost to the block-skipping tokenizer.
fn capture_nested_text(parser: &mut CssParser<'_, '_>) -> String {
    let mut out = String::new();
    let _ = parser.parse_nested_block(|parser| -> Result<(), cssparser::ParseError<'_, ()>> {
        capture_tokens(parser, &mut out);
        Ok(())
    });
    out
}

fn capture_tokens(parser: &mut CssParser<'_, '_>, out: &mut String) {
    loop {
        match parser.next_including_whitespace() {
            Ok(Token::Comment(_)) => {}
            Ok(Token::WhiteSpace(_)) => {
                if !out.is_empty() {
                    out.push(' ');
                }
            }
            Ok(Token::Function(name)) => {
                out.push_str(name);
                out.push('(');
                let _ = parser.parse_nested_block(
                    |parser| -> Result<(), cssparser::ParseError<'_, ()>> {
                        capture_tokens(parser, out);
                        Ok(())
                    },
                );
                out.push(')');
            }
            Ok(Token::ParenthesisBlock) => {
                out.push('(');
                let _ = parser.parse_nested_block(
                    |parser| -> Result<(), cssparser::ParseError<'_, ()>> {
                        capture_tokens(parser, out);
                        Ok(())
                    },
                );
                out.push(')');
            }
            Ok(Token::SquareBracketBlock) => {
                out.push('[');
                let _ = parser.parse_nested_block(
                    |parser| -> Result<(), cssparser::ParseError<'_, ()>> {
                        capture_tokens(parser, out);
                        Ok(())
                    },
                );
                out.push(']');
            }
            Ok(Token::CurlyBracketBlock) => {
                out.push('{');
                let _ = parser.parse_nested_block(
                    |parser| -> Result<(), cssparser::ParseError<'_, ()>> {
                        capture_tokens(parser, out);
                        Ok(())
                    },
                );
                out.push('}');
            }
            Ok(token) => write_token(out, &token),
            Err(_) => break,
        }
    }
}

fn consume_nested(parser: &mut CssParser<'_, '_>) {
    let _ = parser
        .parse_nested_block(|_parser| -> Result<(), cssparser::ParseError<'_, ()>> { Ok(()) });
}

fn and_all(conditions: Vec<MediaCondition>) -> MediaCondition {
    match conditions.len() {
        0 => MediaCondition::And(vec![]),
        1 => conditions.into_iter().next().unwrap(),
        _ => MediaCondition::And(conditions),
    }
}

fn custom_err<'i>(parser: &CssParser<'i, '_>) -> cssparser::ParseError<'i, ()> {
    cssparser::ParseError {
        kind: cssparser::ParseErrorKind::Custom(()),
        location: parser.current_source_location(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_feature() {
        let c = parse_media_prelude("(min-width: 24em)");
        let MediaCondition::Feature(f) = c else {
            panic!("expected feature, got {c:?}");
        };
        assert_eq!(f.name, "width");
    }

    #[test]
    fn parses_not_hover() {
        let c = parse_media_prelude("screen and (not (hover))");
        let MediaCondition::Not(inner) = c else {
            panic!("expected a negated condition, got {c:?}");
        };
        // `(hover)` is a single feature; the group collapses to it.
        assert!(matches!(*inner, MediaCondition::Feature(_)));
    }
}

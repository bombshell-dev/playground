//! Canonical declaration values.
//!
//! The previous lightningcss-backed front-end serialized every value through
//! its printer with `minify: true`. This module reproduces the observable
//! contract with token-level re-serialization: numbers lose redundant
//! leading/trailing zeros (`0.2` → `.2`), and color-property values are
//! validated (a color is a single component: keyword, hash, or function)
//! so invalid declarations report through the recovery paths like they used
//! to. `light-dark(a, b)` is preserved (branches canonicalized) for the
//! runtime, which resolves it against the color scheme at computed-value
//! time.

use bombshell_css_core::Diagnostic;
use bombshell_css_core::tokens::write_token;
use cssparser::{Parser as CssParser, ParserInput, Token};

use crate::colors::named_color;

/// Canonicalize a declaration value; `Err` marks the declaration invalid.
pub(crate) fn canonicalize(name: &str, value: &str) -> Result<String, Diagnostic> {
    // Custom properties keep their value verbatim (substituted text is
    // resolved at computed-value time).
    if name.starts_with("--") {
        return Ok(value.to_string());
    }

    // CSS-wide keywords are valid for every property.
    match value.trim() {
        "inherit" | "initial" | "unset" | "revert" | "revert-layer" => {
            return Ok(value.trim().to_string());
        }
        _ => {}
    }

    if bombshell_css_core::is_color_property(name) {
        // `light-dark(a, b)` survives to the runtime, which resolves it
        // against the environment's color scheme at computed-value time.
        // Both branches are validated and canonicalized here so the IR only
        // ever carries canonical color text.
        if is_light_dark_value(value) {
            let Some((light, dark)) = split_light_dark(value) else {
                return Err(invalid_color(value));
            };
            validate_color(light.trim())?;
            validate_color(dark.trim())?;
            return Ok(minify_value(&format!(
                "light-dark({}, {})",
                canonical_color(light.trim()),
                canonical_color(dark.trim()),
            )));
        }

        validate_color(value)?;
        return Ok(canonical_color(value));
    }

    if name == "font-weight" {
        return Ok(match value.trim() {
            "bold" => "700".to_string(),
            "normal" => "400".to_string(),
            other => other.to_string(),
        });
    }

    Ok(minify_value(value))
}

/// Canonical color text: the shortest representation wins and ties go to
/// hex (the previous front-end's printer behavior: `red` stays, `yellow` →
/// `#ff0`).
fn canonical_color(value: &str) -> String {
    let trimmed = value.trim();
    if let Some(hex) = named_color(trimmed.to_ascii_lowercase().as_str()) {
        return if trimmed.len() < hex.len() {
            trimmed.to_ascii_lowercase()
        } else {
            hex.to_string()
        };
    }
    minify_value(trimmed)
}

/// The shared diagnostic for a color value that does not parse.
fn invalid_color(value: &str) -> Diagnostic {
    Diagnostic::warning(
        "declaration",
        {
            let mut message = String::from("invalid color value `");
            message.push_str(value);
            message.push('`');
            message
        },
    )
}

/// `light-dark(a, b)` → its two branches, split at the top-level comma.
/// Function names are case-insensitive; anything that is not exactly the
/// two-argument form returns `None` (the caller reports it invalid).
fn split_light_dark(value: &str) -> Option<(String, String)> {
    let trimmed = value.trim();
    if !trimmed[..trimmed.len().min("light-dark(".len())]
        .eq_ignore_ascii_case("light-dark(")
    {
        return None;
    }
    let rest = &trimmed["light-dark(".len()..];
    if !rest.ends_with(')') {
        return None;
    }
    let rest = &rest[..rest.len() - 1];

    let mut split: Option<usize> = None;
    let mut depth = 0usize;
    let mut quote: Option<u8> = None;
    for (i, &b) in rest.as_bytes().iter().enumerate() {
        match quote {
            Some(q) if b == q => quote = None,
            Some(_) => {}
            None => match b {
                b'"' | b'\'' => quote = Some(b),
                b'(' => depth += 1,
                b')' => depth = depth.saturating_sub(1),
                b',' if depth == 0 => {
                    if split.is_some() {
                        // A second top-level comma is not the two-argument
                        // form.
                        return None;
                    }
                    split = Some(i);
                }
                _ => {}
            },
        }
    }

    let comma = split?;
    let (light, dark) = (&rest[..comma], &rest[comma + 1..]);
    Some((light.trim().to_string(), dark.trim().to_string()))
}

/// Whether the value is a `light-dark(...)` function call (case-insensitive
/// name, balanced parens).
fn is_light_dark_value(value: &str) -> bool {
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("light-dark(") && trimmed.ends_with(')')
}

/// A color value is one component: a keyword, a hash, or a balanced
/// function call.
///
/// Hex payloads may be 3, 4, 6, or 8 hex digits (`#abc`, `#abcd`,
/// `#aabbcc`, `#aabbccdd`).
fn is_valid_hex(hash: &str) -> bool {
    let bytes = hash.as_bytes();
    matches!(bytes.len(), 3 | 4 | 6 | 8)
        && bytes.iter().all(|b| b.is_ascii_hexdigit())
}

fn validate_color(value: &str) -> Result<(), Diagnostic> {
    let mut input = ParserInput::new(value);
    let mut parser = CssParser::new(&mut input);

    let valid = parser
        .try_parse(|parser| -> Result<(), cssparser::ParseError<'_, ()>> {
            match parser.next_including_whitespace() {
                // Hex colors tokenize as `Hash` when the payload starts with a
                // digit (`#333`) and as `IDHash` when it reads as an
                // identifier (`#fff`); both are the same value grammar,
                // and both still require hex-digit syntax.
                Ok(Token::Hash(hash) | Token::IDHash(hash)) => {
                    if !is_valid_hex(hash) {
                        return Err(cssparser::ParseError {
                            kind: cssparser::ParseErrorKind::Custom(()),
                            location: parser.current_source_location(),
                        });
                    }
                }
                Ok(Token::Ident(ident)) => {
                    let name = ident.to_ascii_lowercase();
                    if named_color(&name).is_none()
                        && name != "currentcolor"
                        && name != "transparent"
                    {
                        return Err(cssparser::ParseError {
                            kind: cssparser::ParseErrorKind::Custom(()),
                            location: parser.current_source_location(),
                        });
                    }
                }
                Ok(Token::Function(_)) => {
                    // Modern spaces accept any balanced function here; the
                    // runtime evaluates the text.
                    parser.parse_nested_block(
                        |parser| -> Result<(), cssparser::ParseError<'_, ()>> {
                            loop {
                                match parser.next_including_whitespace() {
                                    Ok(_) => {}
                                    Err(_) => break,
                                }
                            }
                            Ok(())
                        },
                    )?;
                }
                _ => {
                    return Err(cssparser::ParseError {
                        kind: cssparser::ParseErrorKind::Custom(()),
                        location: parser.current_source_location(),
                    });
                }
            }

            // Nothing else may follow.
            match parser.next_including_whitespace() {
                Err(_) => Ok(()),
                Ok(_) => Err(cssparser::ParseError {
                    kind: cssparser::ParseErrorKind::Custom(()),
                    location: parser.current_source_location(),
                }),
            }
        })
        .is_ok();

    if valid {
        Ok(())
    } else {
        Err(invalid_color(value))
    }
}

/// Re-serialize a value: whitespace collapses to single spaces and numeric
/// tokens drop redundant zeros.
pub(crate) fn minify_value(value: &str) -> String {
    let mut input = ParserInput::new(value);
    let mut parser = CssParser::new(&mut input);
    let mut out = String::with_capacity(value.len());
    write_value_tokens(&mut parser, &mut out);
    out
}

fn write_value_tokens(parser: &mut CssParser<'_, '_>, out: &mut String) {
    let mut pending_space = false;

    loop {
        match parser.next_including_whitespace_and_comments() {
            Ok(token) => match token {
                Token::Comment(_) => {}
                Token::WhiteSpace(_) => pending_space = true,
                Token::Function(_)
                | Token::ParenthesisBlock
                | Token::SquareBracketBlock
                | Token::CurlyBracketBlock => {
                    if pending_space && !out.is_empty() {
                        out.push(' ');
                    }
                    pending_space = false;
                    write_token(out, &token);
                    let closer = match token {
                        Token::SquareBracketBlock => ']',
                        Token::CurlyBracketBlock => '}',
                        _ => ')',
                    };
                    let _ = parser.parse_nested_block(
                        |parser| -> Result<(), cssparser::ParseError<'_, ()>> {
                            write_value_tokens(parser, out);
                            Ok(())
                        },
                    );
                    out.push(closer);
                }
                other => {
                    if pending_space && !out.is_empty() {
                        out.push(' ');
                    }
                    pending_space = false;
                    write_token(out, &other);
                }
            },
            Err(_) => break,
        }
    }
}


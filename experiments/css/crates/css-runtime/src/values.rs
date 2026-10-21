//! `var()` substitution against resolved custom properties.
//!
//! Values are canonical CSS text; substitution walks the token stream so
//! strings and nested functions are handled correctly. Cycles resolve to
//! `None` (the declaration becomes invalid at computed-value time and the
//! caller falls back to inheritance).

use bombshell_css_core::tokens::write_token;
use cssparser::{Parser as CssParser, ParserInput, Token};

use crate::cascade::StyleMap;

/// Resolve every `var(--x[, fallback])` in `value` against `custom`.
///
/// Returns `None` when a referenced variable is missing (no fallback) or a
/// cycle is detected, mirroring "invalid at computed-value time".
pub fn resolve_vars(value: &str, custom: &StyleMap<'_>) -> Option<String> {
    if !value.contains("var(") {
        return Some(value.to_string());
    }
    let mut resolving = Vec::new();
    resolve_value(value, custom, &mut resolving, 0)
}

fn resolve_value(
    value: &str,
    custom: &StyleMap<'_>,
    resolving: &mut Vec<String>,
    depth: u32,
) -> Option<String> {
    if depth > 32 {
        return None;
    }
    if !value.contains("var(") {
        return Some(value.to_string());
    }

    let mut input = ParserInput::new(value);
    let mut parser = CssParser::new(&mut input);
    let mut out = String::new();

    loop {
        match parser.next_including_whitespace() {
            Ok(token) => match token {
                Token::Function(name) if name.eq_ignore_ascii_case("var") => {
                    let substitution = parse_var_arguments(&mut parser, custom, resolving, depth)?;
                    out.push_str(&substitution);
                }
                Token::Function(name) => {
                    out.push_str(name);
                    out.push('(');
                    let inner = parser.parse_nested_block(
                        |parser| -> Result<(), cssparser::ParseError<'_, ()>> {
                            write_tokens(parser, &mut out, custom, resolving, depth);
                            Ok(())
                        },
                    );
                    let _ = inner;
                    out.push(')');
                }
                Token::ParenthesisBlock => {
                    out.push('(');
                    let _ = parser.parse_nested_block(
                        |parser| -> Result<(), cssparser::ParseError<'_, ()>> {
                            write_tokens(parser, &mut out, custom, resolving, depth);
                            Ok(())
                        },
                    );
                    out.push(')');
                }
                other => write_token(&mut out, &other),
            },
            Err(_) => break,
        }
    }
    Some(out)
}

/// Read the arguments of `var(name, fallback?)` and produce the substituted
/// text.
fn parse_var_arguments(
    parser: &mut CssParser,
    custom: &StyleMap<'_>,
    resolving: &mut Vec<String>,
    depth: u32,
) -> Option<String> {
    let mut name: Option<String> = None;
    let mut fallback = String::new();
    let mut in_fallback = false;

    let _ = parser.parse_nested_block(|parser| -> Result<(), cssparser::ParseError<'_, ()>> {
        loop {
            match parser.next_including_whitespace() {
                Ok(token) => match token {
                    Token::Ident(ident) if name.is_none() && !in_fallback => {
                        name = Some(ident.to_string());
                    }
                    Token::Comma if !in_fallback => {
                        in_fallback = true;
                    }
                    other => {
                        if !in_fallback && name.is_some() {
                            // Junk between the name and the comma makes
                            // the var() invalid.
                            return Err(cssparser::ParseError {
                                kind: cssparser::ParseErrorKind::Basic(
                                    cssparser::BasicParseErrorKind::UnexpectedToken(other.clone()),
                                ),
                                location: parser.current_source_location(),
                            });
                        }
                        // The fallback may itself contain var() refs and
                        // nested functions; descend like the main path.
                        match other {
                            Token::Function(fn_name) if fn_name.eq_ignore_ascii_case("var") => {
                                let substitution =
                                    match parse_var_arguments(parser, custom, resolving, depth) {
                                        Some(text) => text,
                                        None => return Ok(()),
                                    };
                                fallback.push_str(&substitution);
                            }
                            Token::Function(fn_name) => {
                                fallback.push_str(fn_name);
                                fallback.push('(');
                                let _ = parser.parse_nested_block(
                                    |parser| -> Result<(), cssparser::ParseError<'_, ()>> {
                                        write_tokens(
                                            parser,
                                            &mut fallback,
                                            custom,
                                            resolving,
                                            depth,
                                        );
                                        Ok(())
                                    },
                                );
                                fallback.push(')');
                            }
                            Token::ParenthesisBlock => {
                                fallback.push('(');
                                let _ = parser.parse_nested_block(
                                    |parser| -> Result<(), cssparser::ParseError<'_, ()>> {
                                        write_tokens(
                                            parser,
                                            &mut fallback,
                                            custom,
                                            resolving,
                                            depth,
                                        );
                                        Ok(())
                                    },
                                );
                                fallback.push(')');
                            }
                            inner => write_token(&mut fallback, &inner),
                        }
                    }
                },
                Err(_) => break,
            }
        }
        Ok(())
    });

    let name = name?;
    if !name.starts_with("--") {
        return None;
    }
    if resolving.contains(&name) {
        return None;
    }

    if let Some(value) = custom.get(name.as_str()) {
        resolving.push(name);
        let resolved = resolve_value(value, custom, resolving, depth + 1);
        resolving.pop();
        return resolved;
    }

    if in_fallback {
        resolve_value(fallback.trim(), custom, resolving, depth + 1)
    } else {
        None
    }
}

/// Serialize the remaining tokens of a nested block into `out`, resolving
/// any `var()` references along the way.
fn write_tokens(
    parser: &mut CssParser,
    out: &mut String,
    custom: &StyleMap<'_>,
    resolving: &mut Vec<String>,
    depth: u32,
) {
    loop {
        match parser.next_including_whitespace() {
            Ok(token) => match token {
                Token::Function(name) if name.eq_ignore_ascii_case("var") => {
                    let substitution = match parse_var_arguments(parser, custom, resolving, depth) {
                        Some(text) => text,
                        None => return,
                    };
                    out.push_str(&substitution);
                }
                Token::Function(name) => {
                    out.push_str(name);
                    out.push('(');
                    let _ = parser.parse_nested_block(
                        |parser| -> Result<(), cssparser::ParseError<'_, ()>> {
                            write_tokens(parser, out, custom, resolving, depth);
                            Ok(())
                        },
                    );
                    out.push(')');
                }
                Token::ParenthesisBlock => {
                    out.push('(');
                    let _ = parser.parse_nested_block(
                        |parser| -> Result<(), cssparser::ParseError<'_, ()>> {
                            write_tokens(parser, out, custom, resolving, depth);
                            Ok(())
                        },
                    );
                    out.push(')');
                }
                other => write_token(out, &other),
            },
            Err(_) => break,
        }
    }
}

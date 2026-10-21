//! Canonical CSS token serialization — the one writer for re-emitting
//! tokenized value/selector text.
//!
//! Both the compiler (value canonicalization, nth canonicalization,
//! condition text) and the runtime (`var()` substitution) rebuild canonical
//! CSS from `cssparser` token streams. This module is that single writer:
//! block tokens serialize as their opening delimiter and callers descend
//! into the nested block themselves; numbers take the pipeline's canonical
//! number form (shortest round-trip f32, no redundant zeros or signs).

#![cfg(feature = "selectors")]

use core::fmt::Write as _;

use cssparser::{CssStringWriter, Token, serialize_identifier, serialize_name, serialize_string};

/// CSS url() body escaping: control characters and spaces hex-escape, the
/// delimiter set backslash-escapes, everything else is literal.
fn serialize_unquoted_url(value: &str, out: &mut String) {
    let mut chunk_start = 0;
    for (i, byte) in value.bytes().enumerate() {
        let hex = matches!(byte, b'\0'..=b' ' | b'\x7F');
        let special = matches!(byte, b'(' | b')' | b'"' | b'\'' | b'\\');
        if !hex && !special {
            continue;
        }
        out.push_str(&value[chunk_start..i]);
        if hex {
            hex_escape(byte, out);
        } else {
            out.push('\\');
            out.push(byte as char);
        }
        chunk_start = i + 1;
    }
    out.push_str(&value[chunk_start..]);
}

fn hex_escape(byte: u8, out: &mut String) {
    const HEX_DIGITS: &[u8; 16] = b"0123456789abcdef";
    if byte > 0x0F {
        out.push('\\');
        out.push(HEX_DIGITS[(byte >> 4) as usize] as char);
        out.push(HEX_DIGITS[(byte & 0x0F) as usize] as char);
    } else {
        out.push('\\');
        out.push(HEX_DIGITS[byte as usize] as char);
    }
    out.push(' ');
}

/// Canonical CSS text of one token. Block tokens (`Function`, bracket
/// blocks) write only their opening delimiter; the caller consumes the
/// nested block and writes the closer.
pub fn write_token(out: &mut String, token: &Token<'_>) {
    match *token {
        Token::Ident(ref value) => {
            let _ = serialize_identifier(value, out);
        }
        Token::AtKeyword(ref value) => {
            out.push('@');
            let _ = serialize_identifier(value, out);
        }
        Token::Hash(ref value) => {
            out.push('#');
            let _ = serialize_name(value, out);
        }
        Token::IDHash(ref value) => {
            out.push('#');
            let _ = serialize_identifier(value, out);
        }
        Token::QuotedString(ref value) => {
            let _ = serialize_string(value, out);
        }
        Token::UnquotedUrl(ref value) => {
            out.push_str("url(");
            serialize_unquoted_url(value, out);
            out.push(')');
        }
        Token::Delim(value) => out.push(value),

        Token::Number { value, has_sign, .. } => write_number(out, value, has_sign),
        Token::Percentage { unit_value, .. } => {
            write_number(out, unit_value * 100.0, false);
            out.push('%');
        }
        Token::Dimension { value, ref unit, has_sign, .. } => {
            write_number(out, value, has_sign);
            // Disambiguate with scientific notation: a unit starting with
            // `e`/`E` would read as an exponent.
            let unit = &**unit;
            if unit == "e" || unit == "E" || unit.starts_with("e-") || unit.starts_with("E-") {
                out.push_str("\\65 ");
                let _ = serialize_name(&unit[1..], out);
            } else {
                let _ = serialize_identifier(unit, out);
            }
        }

        Token::WhiteSpace(content) => out.push_str(content),
        Token::Comment(content) => {
            out.push_str("/*");
            out.push_str(content);
            out.push_str("*/");
        }
        Token::Colon => out.push(':'),
        Token::Semicolon => out.push(';'),
        Token::Comma => out.push(','),
        Token::IncludeMatch => out.push_str("~="),
        Token::DashMatch => out.push_str("|="),
        Token::PrefixMatch => out.push_str("^="),
        Token::SuffixMatch => out.push_str("$="),
        Token::SubstringMatch => out.push_str("*="),
        Token::CDO => out.push_str("<!--"),
        Token::CDC => out.push_str("-->"),

        Token::Function(ref name) => {
            let _ = serialize_identifier(name, out);
            out.push('(');
        }
        Token::ParenthesisBlock => out.push('('),
        Token::SquareBracketBlock => out.push('['),
        Token::CurlyBracketBlock => out.push('{'),

        Token::BadUrl(ref contents) => {
            out.push_str("url(");
            out.push_str(contents);
            out.push(')');
        }
        Token::BadString(ref value) => {
            // The token ends just before its newline, with no closing quote;
            // the content is still escaped like a string body.
            out.push('"');
            let mut escaped = String::new();
            let _ = CssStringWriter::new(&mut escaped).write_str(value);
            out.push_str(&escaped);
        }
        Token::CloseParenthesis => out.push(')'),
        Token::CloseSquareBracket => out.push(']'),
        Token::CloseCurlyBracket => out.push('}'),
    }
}

/// Canonical number text: shortest round-trip f32, `-0` normalized, leading
/// zeros dropped (`.2`), trailing zeros dropped (`2.50` → `2.5`), integers
/// left integer.
pub fn write_number(out: &mut String, value: f32, _has_sign: bool) {
    // Shortest round-trip f32 text (core's float Display). dtoa's f32
    // output diverges from this in the 7th+ significant digit, and the
    // canonical form is pinned by conformance — keep the core formatter.
    let text = format!("{value}");
    if !text.contains('.') {
        out.push_str(&text);
        return;
    }

    let text = text.trim_end_matches('0');
    let text = if text.ends_with('.') { &text[..text.len() - 1] } else { text };
    match text.strip_prefix("-0.") {
        Some(stripped) => {
            out.push_str("-.");
            out.push_str(stripped);
        }
        None => match text.strip_prefix("0.") {
            Some(stripped) => {
                out.push('.');
                out.push_str(stripped);
            }
            None => out.push_str(text),
        },
    }
}

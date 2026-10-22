//! Nesting expansion and selector normalization.
//!
//! Style-rule preludes arrive from the shim as raw source text. The compiler
//! tokenizes them with `cssparser`, rewrites every `&` (nesting selector)
//! into the parent selector — a single parent inlines directly
//! (browser-canonical, keeps specificity exact), a parent list wraps in
//! `:is()` — and re-serializes with canonical whitespace: combinators lose
//! their surrounding spaces, descendant relationships keep exactly one space
//! when the source had one, and `nth-*` arguments keep only the `of` clause
//! spacing.

use bombshell_css_core::tokens::write_token;
use cssparser::{Parser as CssParser, ParserInput, Token};

/// Expand a raw selector prelude against the enclosing parent selectors.
///
/// Every `&` token (including inside functional arguments such as `:is(&, .b)`
/// and `:has(&)`) is replaced by the parent selectors. A nested selector
/// without an explicit `&` gets an implicit descendant prefix.
///
/// `parents` are already-expanded parent selector texts (one complex selector
/// each). With no parents (top level) the text is only normalized.
pub(crate) fn expand_selector_list(text: &str, parents: &[String]) -> String {
    let mut s = Serializer {
        parents,
        out: String::with_capacity(text.len() + 16),
        segments: Vec::new(),
        depth: 0,
        bracket_depth: 0,
        closed: false,
        gap: false,
        first: true,
        saw_nesting: false,
        after_of: false,
    };

    let mut input = ParserInput::new(text);
    let mut parser = CssParser::new(&mut input);

    loop {
        match parser.next_including_whitespace_and_comments() {
            Ok(token) => match token {
                Token::Comment(_) => {}
                Token::WhiteSpace(_) => s.gap = true,
                Token::Comma => s.comma(),
                Token::Delim('&') => s.substitute(),
                Token::Delim('*') => s.universal(),
                Token::Delim(d @ ('>' | '+' | '~')) => s.combinator(*d),
                Token::Delim(d @ ('.' | '#')) => s.attach(*d),
                Token::Delim(d) => s.other_delim(*d),
                Token::Colon => s.colon(),
                Token::Ident(_) | Token::Hash(_) => s.simple(token),
                Token::Function(name) => {
                    s.space();
                    s.out.push_str(name);
                    s.out.push('(');
                    s.enter_block(false, &mut parser);
                    s.out.push(')');
                    s.closed = true;
                    s.gap = false;
                }
                Token::ParenthesisBlock => {
                    s.space();
                    s.out.push('(');
                    s.enter_block(false, &mut parser);
                    s.out.push(')');
                    s.closed = true;
                    s.gap = false;
                }
                Token::SquareBracketBlock => {
                    s.space();
                    s.out.push('[');
                    s.enter_block(true, &mut parser);
                    s.out.push(']');
                    s.closed = true;
                    s.gap = false;
                }
                other => s.other(other),
            },
            Err(_) => break,
        }
    }

    s.finish_segment();

    let joined = if s.segments.len() == 1 {
        s.segments.pop().unwrap_or_default()
    } else {
        s.segments.join(",")
    };

    canonicalize_nth(&joined)
}

fn substitution_text(parents: &[String]) -> String {
    if parents.len() == 1 {
        parents[0].clone()
    } else {
        {
            let mut out = String::from(":is(");
            for (i, parent) in parents.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                out.push_str(parent);
            }
            out.push(')');
            out
        }
    }
}

struct Serializer<'a> {
    parents: &'a [String],
    out: String,
    segments: Vec<String>,
    depth: usize,
    bracket_depth: usize,
    closed: bool,
    gap: bool,
    first: bool,
    saw_nesting: bool,
    after_of: bool,
}

impl<'a> Serializer<'a> {
    fn comma(&mut self) {
        self.finish_segment();
        self.closed = false;
        self.gap = false;
        self.first = true;
        self.saw_nesting = false;
    }

    fn universal(&mut self) {
        self.space();
        self.out.push('*');
        self.closed = true;
        self.gap = false;
        self.first = false;
    }

    fn combinator(&mut self, d: char) {
        self.out.push(d);
        self.closed = false;
        self.gap = false;
        self.first = false;
    }

    fn attach(&mut self, d: char) {
        self.space();
        self.out.push(d);
        self.closed = false;
        self.gap = false;
        self.first = false;
    }

    fn other_delim(&mut self, d: char) {
        self.space();
        self.out.push(d);
        self.closed = true;
        self.gap = false;
        self.first = false;
    }

    fn colon(&mut self) {
        self.space();
        self.out.push(':');
        self.closed = false;
        self.gap = false;
        self.first = false;
    }

    fn simple<'i>(&mut self, token: &Token<'i>) {
        self.space();
        write_token(&mut self.out, token);
        self.closed = true;
        self.gap = false;
        self.first = false;
    }

    fn other<'i>(&mut self, token: &Token<'i>) {
        self.space();
        write_token(&mut self.out, token);
        self.closed = true;
        self.gap = false;
        self.first = false;
    }

    fn enter_block(&mut self, bracket: bool, parser: &mut CssParser<'_, '_>) {
        if bracket {
            self.bracket_depth += 1;
        } else {
            self.depth += 1;
        }
        self.gap = false;
        self.after_of = false;
        self.first = false;
        self.descend(parser);
        if bracket {
            self.bracket_depth -= 1;
        } else {
            self.depth -= 1;
        }
    }

    /// Emit one space when source whitespace separated a completed compound
    /// from a new one (a descendant relationship).
    fn space(&mut self) {
        if self.depth == 0 && self.bracket_depth == 0 && self.gap && !self.first && self.closed {
            self.out.push(' ');
        }
        self.gap = false;
    }

    fn substitute(&mut self) {
        if self.depth == 0 && self.bracket_depth == 0 {
            self.space();
        } else if self.gap && self.after_of {
            self.out.push(' ');
        }
        self.gap = false;
        self.after_of = false;
        self.out.push_str(&substitution_text(self.parents));
        self.closed = true;
        self.gap = false;
        self.first = false;
        self.saw_nesting = true;
    }

    /// Serialize the tokens inside a nested block (function arguments,
    /// attribute blocks), replacing `&`. Argument blocks keep only the
    /// spacing around the An+B `of` clause; attribute blocks keep single
    /// spaces verbatim.
    fn descend(&mut self, parser: &mut CssParser<'_, '_>) {
        let _ = parser.parse_nested_block(|parser| -> Result<(), cssparser::ParseError<'_, ()>> {
            loop {
                match parser.next_including_whitespace_and_comments() {
                    Ok(token) => match token {
                        Token::Comment(_) => {}
                        Token::WhiteSpace(_) => {
                            if self.bracket_depth > 0 && !self.out.ends_with(' ') {
                                self.out.push(' ');
                            } else {
                                self.gap = true;
                            }
                        }
                        Token::Delim('&') => {
                            self.substitute();
                        }
                        token => {
                            // Inside argument blocks whitespace is
                            // insignificant, except around the An+B `of`
                            // keyword.
                            let is_of = matches!(token, Token::Ident(name) if name.eq_ignore_ascii_case("of"));
                            if self.gap && (self.after_of || is_of) {
                                self.out.push(' ');
                            }
                            self.gap = false;
                            write_token(&mut self.out, token);
                            self.after_of = is_of;
                        }
                    },
                    Err(_) => break,
                }
            }
            Ok(())
        });
    }

    fn finish_segment(&mut self) {
        let segment = std::mem::take(&mut self.out);
        let segment = segment.trim();

        if !self.saw_nesting && !self.parents.is_empty() {
            self.segments
                .push({
                    let mut out = substitution_text(self.parents);
                    out.push(' ');
                    out.push_str(&segment);
                    out
                });
        } else {
            self.segments.push(segment.to_string());
        }
    }
}

/// `2n+1` → `odd`, `2n` → `even` inside `nth-*` arguments.
fn canonicalize_nth(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(index) = rest.find("nth-") {
        let (before, after) = rest.split_at(index);
        out.push_str(before);
        rest = after;

        let Some(open) = rest.find('(') else {
            out.push_str(rest);
            return out;
        };
        out.push_str(&rest[..=open]);
        rest = &rest[open + 1..];

        // Canonicalize the leading An+B term of the argument.
        if let Some(tail) = rest.strip_prefix("2n+1") {
            out.push_str("odd");
            rest = tail;
        } else if let Some(tail) = rest.strip_prefix("2n") {
            if matches!(tail.as_bytes().first(), Some(b')' | b',' | b' ')) {
                out.push_str("even");
                rest = tail;
            }
        }

        // Copy until the argument ends (or the next `nth-` may start).
        let mut consumed = 0usize;
        let mut depth = 0usize;
        for (i, c) in rest.char_indices() {
            match c {
                '(' => depth += 1,
                ')' if depth == 0 => {
                    consumed = i;
                    break;
                }
                ')' => depth -= 1,
                _ => {}
            }
            consumed = i + c.len_utf8();
        }
        out.push_str(&rest[..consumed]);
        rest = &rest[consumed..];
    }

    out.push_str(rest);
    out
}

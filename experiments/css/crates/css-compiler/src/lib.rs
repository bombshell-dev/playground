//! Lexbor-backed compiler for the Bombshell CSS pipeline.
//!
//! `compile` parses full modern CSS (Syntax Level 3/4, nesting, media,
//! container, supports, layers) with lexbor's syntax parser via a thin C
//! shim, then performs all semantic work in Rust: nesting expansion against
//! the CSS Nesting spec, typed condition trees, canonicalization, and
//! emission of the versioned [`CompiledStylesheet`] IR consumed by the
//! runtime. Selectors, declaration values, and keyframes cross the boundary
//! as canonical CSS text; conditions cross as typed IR trees.

mod alloc_shim;
mod canonical;
mod colors;
mod conditions;
mod expand;
mod ffi;
mod known_properties;

use bombshell_css_core::selectors::validate_and_specificity;
use bombshell_css_core::{
    CompiledRule, CompiledStylesheet, ContainerQuery, Declaration, Diagnostic, IR_VERSION, Origin,
};
use std::string::String;
use std::vec::Vec;

/// Append `value` in decimal, without pulling `core::fmt`'s integer
/// formatting machinery into the module.
fn push_u32(out: &mut String, mut value: u32) {
    let mut buf = [0u8; 10];
    let mut len = 0;
    loop {
        buf[len] = b'0' + (value % 10) as u8;
        len += 1;
        value /= 10;
        if value == 0 {
            break;
        }
    }
    let bytes = &buf[..len];
    let reversed: Vec<u8> = bytes.iter().rev().copied().collect();
    // SAFETY: digits and `/`-free ASCII.
    out.push_str(core::str::from_utf8(&reversed).unwrap_or(""));
}

/// Options for [`compile`].
#[derive(Debug, Clone)]
pub struct CompileOptions {
    /// Keep parsing after errors, reporting diagnostics and preserving the
    /// recoverable portion of the stylesheet.
    pub error_recovery: bool,
    /// Accepted for API compatibility; output is always canonical.
    pub minify: bool,
}

impl Default for CompileOptions {
    fn default() -> Self {
        CompileOptions {
            error_recovery: true,
            minify: true,
        }
    }
}

/// The result of compiling a stylesheet.
#[derive(Debug, Clone, Default)]
pub struct CompileOutput {
    /// The compiled IR, or `None` when compilation failed without recovery.
    pub sheet: Option<CompiledStylesheet>,
    /// Errors and warnings collected during compilation.
    pub diagnostics: Vec<Diagnostic>,
}

/// Parse and compile CSS into the versioned stylesheet IR.
pub fn compile(css: &str, origin: Origin, options: CompileOptions) -> CompileOutput {
    let Some(events) = ffi::parse_events(css) else {
        return CompileOutput {
            sheet: None,
            diagnostics: vec![Diagnostic::error("parse", "stylesheet parse failed")],
        };
    };

    let mut walker = Walker {
        options,
        css,
        warnings: Vec::new(),
        out: CompiledStylesheet {
            version: IR_VERSION,
            origin,
            rules: Vec::new(),
            layer_order: Vec::new(),
            keyframes: Vec::new(),
            opaque: Vec::new(),
            warnings: Vec::new(),
        },
        stack: vec![Frame::Root],
        next_order: 0,
        anonymous_layers: 0,
        last_at_name: None,
        hard_error: None,
    };

    walker.run(&events);
    walker.out.warnings = walker.warnings.clone();

    if let Some(message) = walker.hard_error {
        // Recovery warnings observed before the fatal error still matter to
        // the host.
        let mut diagnostics = Vec::with_capacity(walker.warnings.len() + 1);
        diagnostics.extend(walker.warnings.clone());
        diagnostics.push(Diagnostic::error("parse", message));
        return CompileOutput {
            sheet: None,
            diagnostics,
        };
    }

    // Warnings ride both the sheet (IR round-trip) and the compile output,
    // so hosts that never decode the IR still see them.
    CompileOutput {
        sheet: Some(walker.out),
        diagnostics: walker.warnings.clone(),
    }
}

/// Walk frames: the event stream is processed with an explicit stack.
enum Frame {
    Root,
    /// A style rule (or `@nest` rule) with its expanded selector context.
    Style(StyleFrame),
    /// A grouping at-rule whose context applies to nested rules.
    At(AtFrame),
    /// A subtree whose events are ignored (inside `@keyframes`/opaque
    /// at-rules, or under a failed rule).
    Skipper,
}

#[derive(Clone)]
struct StyleFrame {
    /// Expanded, validated selector text (comma-separated segments).
    selector: String,
    specificity: u32,
    declarations: Vec<Declaration>,
    /// The rule already emitted (before nested children walked).
    emitted: bool,
}

#[derive(Clone)]
enum AtFrame {
    Media(bombshell_css_core::MediaCondition),
    Container(ContainerQuery),
    Supports(bombshell_css_core::SupportsCondition),
    Layer(Vec<String>),
    Keyframes { name: String },
    Opaque,
}

struct Walker<'t> {
    options: CompileOptions,
    css: &'t str,
    warnings: Vec<Diagnostic>,
    out: CompiledStylesheet,
    stack: Vec<Frame>,
    next_order: u32,
    anonymous_layers: u32,
    last_at_name: Option<String>,
    hard_error: Option<String>,
}

impl<'t> Walker<'t> {
    fn run(&mut self, events: &[ffi::LbxEvent]) {
        for event in events {
            self.event(event);
        }
    }

    fn event(&mut self, event: &ffi::LbxEvent) {
        match event.kind {
            ffi::AT_BEGIN => {
                self.last_at_name = Some(
                    event
                        .span_a(self.css)
                        .trim()
                        .trim_start_matches('@')
                        .to_ascii_lowercase(),
                );
                if self.in_keyframes() || self.in_opaque() {
                    self.stack.push(Frame::Skipper);
                }
            }
            ffi::STYLE_BEGIN => self.style_begin(event),
            ffi::STYLE_END => self.style_end(),
            ffi::AT_PRELUDE => self.at_prelude(event),
            ffi::AT_END => self.at_end(event),
            ffi::DECL => self.declaration(event),
            _ => {}
        }
    }

    fn fail(&mut self, message: impl Into<String>) {
        if self.hard_error.is_none() {
            self.hard_error = Some(message.into());
        }
    }

    fn warn(&mut self, code: &str, message: impl Into<String>) {
        self.warnings
            .push(Diagnostic::warning(code, message.into()));
    }

    /// The enclosing style frame's parent segments (for `&` expansion).
    fn parent_segments(&self) -> Vec<String> {
        for frame in self.stack.iter().rev() {
            if let Frame::Style(style) = frame {
                return style
                    .selector
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .collect();
            }
        }
        Vec::new()
    }

    fn in_keyframes(&self) -> bool {
        self.stack
            .iter()
            .any(|frame| matches!(frame, Frame::At(AtFrame::Keyframes { .. })))
    }

    fn in_opaque(&self) -> bool {
        self.stack
            .iter()
            .any(|frame| matches!(frame, Frame::At(AtFrame::Opaque)))
    }

    fn style_begin(&mut self, event: &ffi::LbxEvent) {
        self.flush_top_style();

        if self.in_keyframes() || self.in_opaque() {
            self.stack.push(Frame::Skipper);
            return;
        }

        let prelude = event.span_a(self.css);
        let parents = self.parent_segments();

        if event.flags & ffi::FLAG_FAILED != 0 {
            if !self.options.error_recovery {
                self.fail("invalid selector list");
            } else {
                self.warn("selector", "a style rule has an invalid selector list");
            }
            self.stack.push(Frame::Skipper);
            return;
        }

        if parents.is_empty() && prelude.contains('&') {
            self.warn(
                "nesting-orphan",
                "a top-level selector contains `&` with no parent selector",
            );
        }

        let expanded = expand::expand_selector_list(prelude, &parents);

        if let Some(frame) = self.build_style_frame(&expanded) {
            self.stack.push(frame);
        } else {
            self.stack.push(Frame::Skipper);
        }
    }

    fn build_style_frame(&mut self, expanded: &str) -> Option<Frame> {
        let specificity = match validate_and_specificity(expanded) {
            Ok(specificity) => specificity,
            Err(()) => {
                if !self.options.error_recovery {
                    self.fail({
                        let mut message = String::from("invalid selector list `");
                        message.push_str(expanded);
                        message.push('`');
                        message
                    });
                } else {
                    self.warn(
                        "selector",
                        {
                            let mut message = String::from(
                                "a style rule has an invalid selector list `",
                            );
                            message.push_str(expanded);
                            message.push('`');
                            message
                        },
                    );
                }
                return None;
            }
        };

        Some(Frame::Style(StyleFrame {
            selector: expanded.to_string(),
            specificity,
            declarations: Vec::new(),
            emitted: false,
        }))
    }

    fn style_end(&mut self) {
        let Some(frame) = self.stack.pop() else {
            return;
        };

        if let Frame::Style(style) = frame {
            if !style.emitted {
                self.emit_style(style);
            }
        }
    }

    /// Emit the top style frame's rule before nested children walk, keeping
    /// source order. Trailing declarations (after nested rules) are emitted
    /// as their own rule against the parent selector, per the old
    /// NestedDeclarations behavior.
    fn flush_top_style(&mut self) {
        let Some(Frame::Style(_)) = self.stack.last() else {
            return;
        };

        let emitted;
        if let Frame::Style(style) = self.stack.last_mut().unwrap() {
            if style.declarations.is_empty() || style.emitted {
                return;
            }
            style.emitted = true;
            emitted = style.clone();
        } else {
            return;
        }

        self.emit_style(emitted);
    }

    fn emit_style(&mut self, style: StyleFrame) {
        if style.declarations.is_empty() {
            return;
        }

        let order = self.next_order;
        self.next_order += 1;

        let (media, containers, supports, layer) = self.context();

        self.out.rules.push(CompiledRule {
            selector: style.selector,
            specificity: style.specificity,
            layer,
            media,
            containers,
            supports,
            declarations: style.declarations,
            order,
        });
    }

    /// Emit a rule carrying only the given declarations (used for trailing
    /// declarations after nested rules; specificity 0 per the old
    /// NestedDeclarations behavior).
    fn emit_trailing(&mut self, selector: String, declarations: Vec<Declaration>) {
        if declarations.is_empty() {
            return;
        }

        let order = self.next_order;
        self.next_order += 1;

        let (media, containers, supports, layer) = self.context();

        self.out.rules.push(CompiledRule {
            selector,
            specificity: 0,
            layer,
            media,
            containers,
            supports,
            declarations,
            order,
        });
    }

    fn at_prelude(&mut self, event: &ffi::LbxEvent) {
        if matches!(self.stack.last(), Some(Frame::Skipper)) {
            return;
        }

        self.flush_top_style();

        let failed = event.flags & ffi::FLAG_FAILED != 0;
        let raw = event.span_a(self.css).trim();
        // The shim may reconstruct the prelude span from the at-keyword;
        // strip a leading `@name` when present.
        let prelude = match raw.strip_prefix('@') {
            Some(rest) => rest
                .split_once(char::is_whitespace)
                .map(|(_, rest)| rest.trim())
                .unwrap_or(""),
            None => raw,
        }
        .to_string();
        let name = self.last_at_name.clone().unwrap_or_default();

        match name.as_str() {
            "media" => {
                if std::env::var("LBX_DEBUG").is_ok() {
                    eprintln!("[at-prelude media] failed={failed} prelude={prelude:?}");
                }
                let condition = if failed {
                    self.condition_failure("media");
                    bombshell_css_core::MediaCondition::Unknown
                } else {
                    let parsed = conditions::parse_media_prelude(&prelude);
                    if std::env::var("LBX_DEBUG").is_ok() {
                        eprintln!("[media-parsed] {parsed:#?}");
                    }
                    parsed
                };
                self.stack.push(Frame::At(AtFrame::Media(condition)));
            }
            "container" => {
                if failed {
                    self.condition_failure("container");
                }
                let (name, condition) = conditions::parse_container_prelude(&prelude);
                self.stack
                    .push(Frame::At(AtFrame::Container(ContainerQuery {
                        name,
                        condition,
                    })));
            }
            "supports" => {
                let condition = if failed {
                    self.condition_failure("supports");
                    bombshell_css_core::SupportsCondition::Unknown
                } else {
                    conditions::parse_supports_prelude(&prelude)
                };
                self.stack.push(Frame::At(AtFrame::Supports(condition)));
            }
            "layer" => {
                let mut paths: Vec<Vec<String>> = Vec::new();
                if prelude.is_empty() {
                    self.anonymous_layers += 1;
                    paths.push(vec![{
                        let mut name = String::from("_anonymous-layer-");
                        push_u32(&mut name, self.anonymous_layers);
                        name
                    }]);
                } else {
                    for name in prelude.split(',') {
                        let path: Vec<String> =
                            name.trim().split('.').map(str::to_string).collect();
                        paths.push(path);
                    }
                }
                for path in &paths {
                    self.ensure_layer_path(path);
                }
                let path = paths.first().cloned().unwrap_or_default();
                self.stack.push(Frame::At(AtFrame::Layer(path)));
            }
            "keyframes" => {
                self.stack.push(Frame::At(AtFrame::Keyframes {
                    name: unquote(&prelude),
                }));
            }
            "nest" => {
                let parents = self.parent_segments();
                if parents.is_empty() {
                    self.warn("nesting-orphan", "@nest rule has no enclosing style rule");
                    self.stack.push(Frame::Skipper);
                    return;
                }
                let expanded = expand::expand_selector_list(&prelude, &parents);
                if let Some(frame) = self.build_style_frame(&expanded) {
                    self.stack.push(frame);
                } else {
                    self.stack.push(Frame::Skipper);
                }
            }
            "import" => {
                self.warn(
                    "unresolved-import",
                    "@import is not resolved by this pipeline; the rule is preserved verbatim",
                );
                self.stack.push(Frame::At(AtFrame::Opaque));
            }
            _ => {
                self.stack.push(Frame::At(AtFrame::Opaque));
            }
        }
    }

    fn condition_failure(&mut self, kind: &str) {
        if !self.options.error_recovery {
            self.fail({
                let mut message = String::from("invalid ");
                message.push_str(kind);
                message.push_str(" prelude");
                message
            });
        } else {
            self.warn(kind, {
                let mut message = String::from("an @");
                message.push_str(kind);
                message.push_str(" prelude failed to parse");
                message
            });
        }
    }

    fn at_end(&mut self, event: &ffi::LbxEvent) {
        let Some(frame) = self.stack.pop() else {
            return;
        };

        match frame {
            Frame::At(AtFrame::Opaque) => {
                let text = event.span_a(self.css).trim().to_string();
                if !text.is_empty() {
                    self.out
                        .opaque
                        .push(bombshell_css_core::OpaqueRule { text });
                }
            }
            Frame::At(AtFrame::Keyframes { name }) => {
                let body = event.span_a(self.css).trim().to_string();
                self.out
                    .keyframes
                    .push(bombshell_css_core::KeyframesRule { name, body });
            }
            // Media, container, supports, and layer frames just pop; nested
            // events already consumed the context. A `@nest` frame carries a
            // style rule and emits like any other.
            Frame::Style(style) => self.emit_style(style),
            _ => {}
        }
    }

    fn declaration(&mut self, event: &ffi::LbxEvent) {
        // Find the frame that owns this declaration.
        let mut target: Option<usize> = None;
        for (index, frame) in self.stack.iter().enumerate().rev() {
            match frame {
                Frame::Style(_) => {
                    target = Some(index);
                    break;
                }
                Frame::Skipper | Frame::At(AtFrame::Keyframes { .. } | AtFrame::Opaque) => return,
                Frame::At(_) | Frame::Root => continue,
            }
        }

        let Some(index) = target else {
            return;
        };

        let name = event.span_a(self.css).trim().to_string();
        let value = event.span_b(self.css).trim().to_string();

        if event.flags & ffi::FLAG_FAILED != 0 {
            if !self.options.error_recovery {
                self.fail({
                    let mut message = String::from("invalid declaration `");
                    message.push_str(&name);
                    message.push('`');
                    message
                });
            } else {
                self.warn("declaration", {
                    let mut message = String::from("invalid value for `");
                    message.push_str(&name);
                    message.push('`');
                    message
                });
            }
            return;
        }

        if name.is_empty() {
            return;
        }

        let important = event.flags & ffi::FLAG_IMPORTANT != 0;

        let value = match canonical::canonicalize(&name, &value) {
            Ok(value) => value,
            Err(diagnostic) => {
                if !self.options.error_recovery {
                    self.fail({
                        let mut message = String::from("invalid declaration `");
                        message.push_str(&name);
                        message.push_str(": ");
                        message.push_str(&value);
                        message.push('`');
                        message
                    });
                } else {
                    self.warnings.push(diagnostic);
                }
                return;
            }
        };

        let (already_emitted, selector) = match &self.stack[index] {
            Frame::Style(style) => (style.emitted, style.selector.clone()),
            _ => return,
        };

        if already_emitted {
            let selector = selector
                .split(',')
                .map(|s| s.trim().to_string())
                .collect::<Vec<_>>()
                .join(",");
            self.emit_trailing(
                selector,
                vec![Declaration {
                    name,
                    value,
                    important,
                }],
            );
            return;
        }

        let Frame::Style(style) = &mut self.stack[index] else {
            return;
        };

        // Canonicalized per rule: each property at most once, last value wins.
        match style.declarations.iter_mut().find(|d| d.name == name) {
            Some(existing) => {
                existing.value = value;
                existing.important = important;
            }
            None => style.declarations.push(Declaration {
                name,
                value,
                important,
            }),
        }
    }

    /// Cascade context carried by the at-rule frames enclosing the rule.
    fn context(
        &self,
    ) -> (
        Vec<bombshell_css_core::MediaCondition>,
        Vec<ContainerQuery>,
        Vec<bombshell_css_core::SupportsCondition>,
        Option<Vec<String>>,
    ) {
        let mut media = Vec::new();
        let mut containers = Vec::new();
        let mut supports = Vec::new();
        let mut layer = None;

        for frame in &self.stack {
            match frame {
                Frame::At(AtFrame::Media(condition)) => media.push(condition.clone()),
                Frame::At(AtFrame::Container(query)) => containers.push(query.clone()),
                Frame::At(AtFrame::Supports(condition)) => supports.push(condition.clone()),
                Frame::At(AtFrame::Layer(path)) => {
                    let mut joined: Vec<String> = layer.clone().unwrap_or_default();
                    joined.extend(path.clone());
                    layer = Some(joined);
                }
                _ => {}
            }
        }

        (media, containers, supports, layer)
    }

    fn ensure_layer_path(&mut self, path: &[String]) {
        // Register the path and every ancestor prefix in first-appearance order.
        for end in 1..=path.len() {
            let prefix = &path[..end];
            if !self.out.layer_order.iter().any(|p| p == prefix) {
                self.out.layer_order.push(prefix.to_vec());
            }
        }
    }
}

fn unquote(text: &str) -> String {
    let text = text.trim();
    if text.len() >= 2
        && (text.starts_with('"') && text.ends_with('"')
            || text.starts_with('\'') && text.ends_with('\''))
    {
        text[1..text.len() - 1].to_string()
    } else {
        text.to_string()
    }
}

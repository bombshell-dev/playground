//! WIT component adapter: the only public ABI of the CSS pipeline.
//!
//! Hosts receive compiled IR as opaque bytes and evaluate computed styles
//! against a flat tree snapshot, keeping the linear-memory contract free of
//! Rust or JavaScript object layouts.

/// The component glue only makes sense for the wasm component target; the
/// crate is a `cdylib`, and an empty dylib on native hosts keeps
/// `cargo build --workspace` runnable everywhere.
#[cfg(target_arch = "wasm32")]
mod guest {
    wit_bindgen::generate!({
        path: "../../wit/css.wit",
    });

    use std::cell::RefCell;

    use bombshell::css::types::{
        ColorScheme as WitColorScheme, Diagnostic as WitDiagnostic, Environment as WitEnvironment,
        Node as WitNode, NodeState, Origin as WitOrigin, Severity as WitSeverity,
    };
    use bombshell_css_compiler::{CompileOptions, compile};
    use bombshell_css_core::{
        ColorScheme, CompiledStylesheet, Diagnostic, Environment, NodeSnapshot, Origin, Severity,
        TreeSnapshot, decode_ir, encode_ir,
    };
    use bombshell_css_runtime::Stylesheet;
    use exports::bombshell::css::stylesheet::CompiledSheet;
    use exports::bombshell::css::stylesheet::Guest;

    struct Css;

    impl Guest for Css {
        fn compile(css: String, origin: WitOrigin) -> CompiledSheet {
            let origin = to_origin(origin);
            let output = compile(&css, origin, CompileOptions::default());
            let ir = output.sheet.as_ref().map(encode_ir);
            CompiledSheet {
                ir,
                diagnostics: to_diagnostics(output.diagnostics),
            }
        }

        fn prepare(ir: Vec<u8>) -> Option<u32> {
            // Ownership of `ir` transfers to the module (zero-copy lift);
            // decode, then leak the decoded IR so the parsed stylesheet can
            // borrow from it for the lifetime of the handle.
            let Ok(decoded) = decode_ir(&ir) else {
                return None;
            };
            let sheet_ir: &'static CompiledStylesheet = Box::leak(Box::new(decoded));
            let sheet = Stylesheet::from_ir(sheet_ir, 0);

            SHEETS.with(|cell| {
                let mut slots = cell.borrow_mut();
                let index = match slots.iter().position(|slot| slot.is_none()) {
                    Some(index) => index,
                    None => {
                        slots.push(None);
                        slots.len() - 1
                    }
                };
                slots[index] = Some(SheetSlot {
                    ir: sheet_ir,
                    sheet,
                });
                Some(index as u32)
            })
        }

        fn compute(
            sheets: Vec<u32>,
            nodes: Vec<WitNode>,
            parents: Vec<u32>,
            target: u32,
            env: WitEnvironment,
        ) -> Vec<(String, String)> {
            let Ok(tree) = to_tree(nodes, parents) else {
                return Vec::new();
            };
            let Ok(target) = usize::try_from(target) else {
                return Vec::new();
            };
            let environment = to_environment(env);

            SHEETS.with(|cell| -> Vec<(String, String)> {
                let slots = cell.borrow();
                let loaded: Vec<&bombshell_css_runtime::Stylesheet> = sheets
                    .iter()
                    .filter_map(|&sheet| {
                        slots
                            .get(sheet as usize)
                            .and_then(|slot| slot.as_ref())
                            .map(|entry| &entry.sheet)
                    })
                    .collect();
                let style = bombshell_css_runtime::compute(&loaded, &tree, target, &environment);
                // Names borrow the IR and values borrow until a var()
                // substitution; the canonical-ABI lowering needs owned text.
                style
                    .map(|style| {
                        style
                            .declarations
                            .into_iter()
                            .map(|(name, value)| (String::from(name), value.into_owned()))
                            .collect()
                    })
                    .unwrap_or_default()
            })
        }

        fn compute_tree(
            sheets: Vec<u32>,
            nodes: Vec<WitNode>,
            parents: Vec<u32>,
            env: WitEnvironment,
        ) -> Vec<Vec<(String, String)>> {
            let Ok(tree) = to_tree(nodes, parents) else {
                return Vec::new();
            };
            let environment = to_environment(env);

            SHEETS.with(|cell| -> Vec<Vec<(String, String)>> {
                let slots = cell.borrow();
                let loaded: Vec<&bombshell_css_runtime::Stylesheet> = sheets
                    .iter()
                    .filter_map(|&sheet| {
                        slots
                            .get(sheet as usize)
                            .and_then(|slot| slot.as_ref())
                            .map(|entry| &entry.sheet)
                    })
                    .collect();
                bombshell_css_runtime::cascade::compute_tree(&loaded, &tree, &environment, &[])
                .into_iter()
                .map(|style| {
                    style
                        .map(|style| {
                            style
                                .declarations
                                .into_iter()
                                .map(|(name, value)| (String::from(name), value.into_owned()))
                                .collect()
                        })
                        .unwrap_or_default()
                })
                .collect()
            })
        }

        fn release(sheet: u32) {
            SHEETS.with(|cell| {
                let mut slots = cell.borrow_mut();
                if let Some(entry) = slots.get_mut(sheet as usize).and_then(|slot| slot.take()) {
                    // The parsed stylesheet borrows from the leaked IR; drop
                    // it before freeing the IR so the borrow is gone first.
                    let SheetSlot { ir, sheet } = entry;
                    drop(sheet);
                    // SAFETY: `ir` came from `Box::leak` in `prepare`, and
                    // the borrowing stylesheet was dropped above.
                    drop(unsafe { Box::from_raw(ir as *const CompiledStylesheet as *mut CompiledStylesheet) });
                }
            });
        }
    }

    struct SheetSlot {
        /// The leaked decoded IR, kept so `release` can free it.
        ir: &'static CompiledStylesheet,
        sheet: Stylesheet<'static>,
    }

    thread_local! {
        static SHEETS: RefCell<Vec<Option<SheetSlot>>> = const { RefCell::new(Vec::new()) };
    }

    fn to_origin(origin: WitOrigin) -> Origin {
        match origin {
            WitOrigin::UserAgent => Origin::UserAgent,
            WitOrigin::User => Origin::User,
            WitOrigin::Author => Origin::Author,
        }
    }

    fn to_diagnostics(diagnostics: Vec<Diagnostic>) -> Vec<WitDiagnostic> {
        diagnostics
            .into_iter()
            .map(|d| WitDiagnostic {
                severity: match d.severity {
                    Severity::Error => WitSeverity::Error,
                    Severity::Warning => WitSeverity::Warning,
                },
                code: d.code,
                message: d.message,
            })
            .collect()
    }

    fn to_tree(nodes: Vec<WitNode>, parents: Vec<u32>) -> Result<TreeSnapshot, ()> {
        if nodes.len() != parents.len() {
            return Err(());
        }
        let nodes = nodes
            .into_iter()
            .map(|n| NodeSnapshot {
                tag: n.tag,
                id: n.id,
                classes: n.classes,
                attributes: n.attributes,
                focus: n.state.contains(NodeState::FOCUS),
                hover: n.state.contains(NodeState::HOVER),
                active: n.state.contains(NodeState::ACTIVE),
                width: n.width,
                height: n.height,
                style: n.style,
            })
            .collect();
        Ok(TreeSnapshot { nodes, parents })
    }

    fn to_environment(env: WitEnvironment) -> Environment {
        Environment {
            viewport_width: env.viewport_width,
            viewport_height: env.viewport_height,
            color_scheme: match env.color_scheme {
                WitColorScheme::Light => ColorScheme::Light,
                WitColorScheme::Dark => ColorScheme::Dark,
            },
            reduced_motion: env.reduced_motion,
            resolution: env.resolution,
        }
    }

    export!(Css);
}

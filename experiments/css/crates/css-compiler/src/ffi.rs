//! FFI boundary to the lexbor shim (`c/shim.c`).

use std::os::raw::c_int;
use std::sync::{Mutex, MutexGuard, OnceLock};

/// Event kinds emitted by the shim. Spans are byte offsets into the original
/// stylesheet text.
pub const STYLE_BEGIN: u8 = 0;
pub const STYLE_END: u8 = 1;
pub const AT_BEGIN: u8 = 2;
pub const AT_PRELUDE: u8 = 3;
pub const AT_END: u8 = 4;
pub const DECL: u8 = 5;

pub const FLAG_IMPORTANT: u8 = 0x01;
pub const FLAG_FAILED: u8 = 0x02;

/// One shim event. `a`/`b` are `[start, end)` byte ranges into the source.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct LbxEvent {
    pub kind: u8,
    pub flags: u8,
    pub a0: u32,
    pub a1: u32,
    pub b0: u32,
    pub b1: u32,
}

impl LbxEvent {
    pub fn span_a<'t>(&self, text: &'t str) -> &'t str {
        &text[self.a0 as usize..self.a1 as usize]
    }

    pub fn span_b<'t>(&self, text: &'t str) -> &'t str {
        &text[self.b0 as usize..self.b1 as usize]
    }
}

unsafe extern "C" {
    /// Parse a stylesheet into the event stream. Returns 0 on success. The
    /// event array is allocated by the shim and must be released with
    /// `lbx_free_events`.
    fn lbx_parse(
        css: *const u8,
        css_len: usize,
        out_events: *mut *mut LbxEvent,
        out_len: *mut usize,
    ) -> c_int;

    fn lbx_free_events(events: *mut LbxEvent, len: usize);
}

/// The shim keeps one global context per process; guard the C boundary.
fn shim_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _ = LOCK.get_or_init(|| Mutex::new(()));
    LOCK.get()
        .unwrap()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Parse a stylesheet into the shim event stream.
pub(crate) fn parse_events(css: &str) -> Option<Vec<LbxEvent>> {
    let _guard = shim_lock();

    let bytes = css.as_bytes();
    let mut events: *mut LbxEvent = std::ptr::null_mut();
    let mut len: usize = 0;

    let status = unsafe { lbx_parse(bytes.as_ptr(), bytes.len(), &mut events, &mut len) };

    if status != 0 {
        return None;
    }

    let slice = unsafe { std::slice::from_raw_parts(events, len) };
    let owned = slice.to_vec();
    unsafe { lbx_free_events(events, len) };

    Some(owned)
}

//! C allocator for freestanding wasm32.
//!
//! lexbor's allocator calls `malloc`/`free`/`calloc`/`realloc`; on
//! `wasm32-unknown-unknown` there is no libc, so these are backed by the
//! Rust global allocator. Every allocation carries a size header so `free`
//! can reconstruct the layout (alignment is fixed at the header's).

#![cfg(target_arch = "wasm32")]

use std::alloc::{Layout, alloc, alloc_zeroed, dealloc};

#[repr(C)]
struct Header {
    size: usize,
}

const HEADER_ALIGN: usize = core::mem::align_of::<Header>();

fn padded(size: usize) -> usize {
    (size + HEADER_ALIGN - 1) & !(HEADER_ALIGN - 1)
}

#[unsafe(no_mangle)]
pub extern "C" fn malloc(size: usize) -> *mut u8 {
    let size = size.max(1);
    let Ok(layout) = Layout::from_size_align(size_of::<Header>() + padded(size), HEADER_ALIGN)
    else {
        return std::ptr::null_mut();
    };

    unsafe {
        let base = alloc(layout);
        if base.is_null() {
            return std::ptr::null_mut();
        }
        *(base as *mut Header) = Header { size };
        base.add(size_of::<Header>())
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn free(pointer: *mut u8) {
    if pointer.is_null() {
        return;
    }

    unsafe {
        let header = pointer.sub(size_of::<Header>()) as *mut Header;
        let size = (*header).size;
        if let Ok(layout) = Layout::from_size_align(
            size_of::<Header>() + padded(size),
            HEADER_ALIGN,
        ) {
            dealloc(pointer.sub(size_of::<Header>()), layout);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn calloc(count: usize, size: usize) -> *mut u8 {
    let Some(total) = count.checked_mul(size) else {
        return std::ptr::null_mut();
    };
    let total = total.max(1);
    let Ok(layout) = Layout::from_size_align(size_of::<Header>() + padded(total), HEADER_ALIGN)
    else {
        return std::ptr::null_mut();
    };

    unsafe {
        let base = alloc_zeroed(layout);
        if base.is_null() {
            return std::ptr::null_mut();
        }
        *(base as *mut Header) = Header { size: total };
        base.add(size_of::<Header>())
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn realloc(pointer: *mut u8, size: usize) -> *mut u8 {
    if pointer.is_null() {
        return malloc(size);
    }

    let old_size = unsafe { (*(pointer.sub(size_of::<Header>()) as *const Header)).size };

    let new = malloc(size);
    if new.is_null() {
        return std::ptr::null_mut();
    }

    unsafe {
        std::ptr::copy_nonoverlapping(pointer, new, old_size.min(size));
    }

    free(pointer);

    new
}
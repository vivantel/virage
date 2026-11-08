//! Resolves the C23 `strto*` entry points that the prebuilt static ONNX Runtime references.
//!
//! The ONNX Runtime archive that `ort` downloads is compiled against glibc >= 2.38 headers, where
//! `strtol`/`strtoll`/`strtoull` are redirected to `__isoc23_strtol`/`__isoc23_strtoll`/
//! `__isoc23_strtoull`. A cdylib may link with those symbols undefined, so the published plugin
//! then fails at `dlopen` on older glibc (Ubuntu 22.04: "undefined symbol: __isoc23_strtoull")
//! even though the plugin itself is built on a glibc 2.28 baseline.
//!
//! Defining them here makes the plugin self-sufficient. On a glibc that already provides them the
//! dynamic linker resolves the references to libc first (global scope precedes the plugin's local
//! scope), so these wrappers are only reached where the symbols are missing. The only behavioural
//! difference between the C23 and classic variants is `0b`/`0B` binary-prefix parsing for base 0
//! and 2, which ONNX Runtime does not rely on.

use std::ffi::{c_char, c_int, c_long, c_longlong, c_ulonglong};

extern "C" {
    fn strtol(s: *const c_char, end: *mut *mut c_char, base: c_int) -> c_long;
    fn strtoll(s: *const c_char, end: *mut *mut c_char, base: c_int) -> c_longlong;
    fn strtoull(s: *const c_char, end: *mut *mut c_char, base: c_int) -> c_ulonglong;
}

// SAFETY (all three): each wrapper forwards its arguments unchanged to the libc function of the
// same signature, so the caller's obligations (valid NUL-terminated `s`, `end` null or writable)
// are exactly libc's own. A `no_mangle` export is required: the symbol must be visible to the
// dynamic linker by its C name, which a safe Rust item cannot be.
#[no_mangle]
pub unsafe extern "C" fn __isoc23_strtol(
    s: *const c_char,
    end: *mut *mut c_char,
    base: c_int,
) -> c_long {
    strtol(s, end, base)
}

#[no_mangle]
pub unsafe extern "C" fn __isoc23_strtoll(
    s: *const c_char,
    end: *mut *mut c_char,
    base: c_int,
) -> c_longlong {
    strtoll(s, end, base)
}

#[no_mangle]
pub unsafe extern "C" fn __isoc23_strtoull(
    s: *const c_char,
    end: *mut *mut c_char,
    base: c_int,
) -> c_ulonglong {
    strtoull(s, end, base)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ptr;

    #[test]
    fn shims_parse_like_libc() {
        let n = c"  -42rest";
        let mut end: *mut c_char = ptr::null_mut();
        let v = unsafe { __isoc23_strtol(n.as_ptr(), &mut end, 10) };
        assert_eq!(v, -42);
        assert_eq!(unsafe { *end } as u8, b'r');

        let h = c"ff";
        assert_eq!(
            unsafe { __isoc23_strtoll(h.as_ptr(), ptr::null_mut(), 16) },
            255
        );
        let big = c"18446744073709551615";
        assert_eq!(
            unsafe { __isoc23_strtoull(big.as_ptr(), ptr::null_mut(), 10) },
            u64::MAX
        );
    }
}

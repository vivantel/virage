//! Deliberately mismatched dylib plugin fixture, for testing the dylib-plugin host's
//! ABI-version-rejection path. Exports only `virage_plugin_abi_version`, returning a value that
//! will never match `PLUGIN_ABI_VERSION` — a loader must reject this immediately after reading
//! that one symbol, before looking up any other vtable function (which don't exist here at all).

/// Returns a version number chosen to never collide with a real `PLUGIN_ABI_VERSION` (currently
/// `2`) — `u32::MAX` rather than a small hand-picked number, so a future ABI bump can't
/// accidentally make this fixture start passing.
#[no_mangle]
pub extern "C" fn virage_plugin_abi_version() -> u32 {
    u32::MAX
}

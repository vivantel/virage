fn main() {
    if std::env::var("CARGO_FEATURE_DOWNLOAD_BINARIES").is_ok()
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux")
    {
        // Weak stubs for symbols absent on glibc 2.17 / GCC 10 libstdc++ (see ort_glibc_compat.c).
        // --whole-archive forces GNU ld BFD to pull in all stubs regardless of link order:
        // Cargo places virage-engine's build outputs before ort-sys's libonnxruntime.a, so a
        // plain rustc-link-lib scan sees the archive before any undefined refs exist and skips it.
        cc::Build::new()
            .file("src/ort_glibc_compat.c")
            .compile("ort_glibc_compat");
        println!("cargo:rustc-link-arg=-Wl,--whole-archive,-Bstatic,-lort_glibc_compat,-Bdynamic,--no-whole-archive");

        // Forces libstdc++ global locale construction (see ort_locale_init.cpp) before
        // any ORT code runs. Same --whole-archive requirement as the stub above: cc::Build
        // wraps this in a static archive too, so it needs forcing or the linker drops it
        // as unreferenced (nothing calls its symbols directly -- only its global
        // constructor matters).
        cc::Build::new()
            .cpp(true)
            .file("src/ort_locale_init.cpp")
            .compile("ort_locale_init");
        println!("cargo:rustc-link-arg=-Wl,--whole-archive,-Bstatic,-lort_locale_init,-Bdynamic,--no-whole-archive");

        // libonnxruntime.a is a C++ archive; GCC does not auto-link libstdc++.
        println!("cargo:rustc-link-lib=stdc++");
    }
}

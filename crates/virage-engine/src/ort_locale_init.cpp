// Forces libstdc++ global locale construction before any ORT code runs.
//
// ORT's prebuilt libonnxruntime.a uses std::regex internally (observed crash site:
// std::__cxx11::regex_traits<char>::transform, called with a garbage `this` pointing
// at address 0x43 -- consistent with a never-constructed global locale facet). In a
// normal g++-linked C++ program, some translation unit's static ios_base::Init object
// guarantees this runs before main(); in a Rust-hosted binary that only selectively
// links objects out of a prebuilt static archive, the relevant initializer can be
// dropped by the linker's archive-member selection (nothing else references its
// symbols directly), leaving global locale facets zero-initialized until first use.
// Compiling this as our own object file (not inside an archive) guarantees it's linked
// and its constructor runs via .init_array before Rust's main().
#include <cstdio>
#include <locale>

namespace {
struct ForceLocaleInit {
  ForceLocaleInit() {
    // std::locale::classic() is itself a lazily-initialized magic static (the "C" locale
    // singleton) -- if it suffers the same archive-elimination problem as everything else
    // here, calling global(classic()) just propagates an already-broken locale. Building
    // one from scratch via the "C" name goes through full construction, not a singleton
    // lookup.
    std::locale::global(std::locale("C"));
    std::fprintf(stderr, "[ort_locale_init] global locale constructor ran\n");
  }
};

__attribute__((init_priority(101))) ForceLocaleInit force_locale_init_instance;
}  // namespace

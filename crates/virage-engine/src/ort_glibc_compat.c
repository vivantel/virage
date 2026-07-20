/*
 * Weak stubs for symbols referenced by ORT's prebuilt libonnxruntime.a that are absent
 * on glibc 2.17 (manylinux2014) or GCC 10's libstdc++. __attribute__((weak)) ensures
 * that strong definitions from glibc.so / libstdc++.so win at runtime on newer systems.
 *
 * These stubs are force-included via --whole-archive (see build.rs) because Cargo places
 * virage-engine's build outputs before ort-sys's libonnxruntime.a in the link command;
 * GNU ld BFD's left-to-right scan would otherwise skip them before the undefined refs exist.
 *
 * C23 base functions are declared explicitly (not via <stdlib.h>) to avoid header macro
 * redirections that would cause infinite recursion on glibc 2.38+.
 */

#include <stdlib.h> /* for abort() */

extern long strtol(const char *, char **, int);
extern long long strtoll(const char *, char **, int);
extern long long strtoll_l(const char *, char **, int, void *);
extern unsigned long strtoul(const char *, char **, int);
extern unsigned long long strtoull(const char *, char **, int);
extern unsigned long long strtoull_l(const char *, char **, int, void *);

__attribute__((weak))
long __isoc23_strtol(const char *n, char **e, int b) { return strtol(n, e, b); }

__attribute__((weak))
long long __isoc23_strtoll(const char *n, char **e, int b) { return strtoll(n, e, b); }

__attribute__((weak))
long long __isoc23_strtoll_l(const char *n, char **e, int b, void *l) { return strtoll_l(n, e, b, l); }

__attribute__((weak))
unsigned long __isoc23_strtoul(const char *n, char **e, int b) { return strtoul(n, e, b); }

__attribute__((weak))
unsigned long long __isoc23_strtoull(const char *n, char **e, int b) { return strtoull(n, e, b); }

__attribute__((weak))
unsigned long long __isoc23_strtoull_l(const char *n, char **e, int b, void *l) { return strtoull_l(n, e, b, l); }

/* glibc 2.32+: global flag used by libstdc++ to skip locks in single-threaded programs.
 * 0 = multi-threaded (conservative; takes the full thread-safe path). */
__attribute__((weak)) char __libc_single_threaded = 0;

/* libstdc++ 11+: called on allocation size overflow. Mangled name used directly for
 * C-file compatibility. abort() is safe — only reached on pathological inputs. */
__attribute__((weak)) void _ZSt28__throw_bad_array_new_lengthv(void) { abort(); }

/* libstdc++ 11+: std::string::reserve() with no arguments (shrink-to-fit semantics).
 * No-op stub: callers only use it for memory optimisation, not correctness. */
__attribute__((weak)) void _ZNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEE7reserveEv(void *self) { (void)self; }

# Guardrail: Rust napi-rs Patterns

## napi-rs Function Signature

Every `#[napi]` function that returns a ViDoc tree MUST return `String` (JSON-encoded), not a custom type:

```rust
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

#[napi]
pub fn parse_pdf(buf: Buffer) -> napi::Result<String> {
    let bytes: &[u8] = &buf;
    let doc = parser::parse(bytes)?;
    serde_json::to_string(&doc).map_err(|e| napi::Error::new(
        napi::Status::GenericFailure,
        e.to_string(),
    ))
}
```

**Why `String` not a struct?** Returning a Rust struct through napi-rs requires napi-rs to generate JS/TypeScript bindings for it. Returning JSON keeps the Rust↔JS boundary simple and decoupled from TypeScript type evolution.

## `virage-vidoc` Path Dependency

Every chunker crate uses the shared DocNode types via a workspace path dependency:

```toml
# In packages/virage-chunker-ce-{format}/Cargo.toml
[dependencies]
virage-vidoc = { workspace = true }
```

Do NOT copy `vidoc.rs` into each package — always use the workspace dep.

## `crate-type = ["cdylib"]`

Every chunker crate MUST declare `[lib] crate-type = ["cdylib"]` in its `Cargo.toml`. This tells Rust to compile to a dynamic library (`.so`, `.dylib`, `.dll`) that Node.js can load as a native addon.

## `native.ts` Loading Pattern

```typescript
// Lazy-load the native binary; give a helpful error if not found.
import { createRequire } from "module";
const require = createRequire(import.meta.url);

let _fn: ((buf: Buffer) => string) | undefined;

function load(): (buf: Buffer) => string {
  if (_fn) return _fn;
  try {
    const b = require("./virage_chunker_ce_pdf.node") as any;
    _fn = b.parsePdf;
    return _fn!;
  } catch {
    throw new Error(
      "[@vivantel/virage-chunker-ce-pdf] Native binary not found.\n" +
      "Run: npx napi build --release  (or install the platform package)",
    );
  }
}
```

The `.node` filename matches the Rust crate name with hyphens converted to underscores.

## Type Generation

`napi build` auto-generates an `index.d.ts` in the output directory alongside the `.node` file. If using `--output-dir npm/<platform>/`, the `.d.ts` lands there too. Import the generated types from the `src-ts/` layer, not directly from `npm/`.

## Cargo Workspace Membership

Every new Rust chunker package MUST be listed in the root `Cargo.toml` workspace `members` array. The glob `"packages/*"` already covers them if the `Cargo.toml` is present.

## Build (CI)

```yaml
- run: npx napi build --release --target ${{ matrix.target }}
  working-directory: packages/virage-chunker-ce-pdf
```

The `napi` CLI reads `Cargo.toml` in the working directory and places the `.node` binary in the same directory. The platform stub packages in `npm/<platform>/` need the binary placed there before publishing.

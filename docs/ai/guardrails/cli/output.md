# Guardrail: CLI Output System

## Rule

All CLI output **must** go through `createOut(verbosity)` from `packages/virage-cli/src/output.ts`.  
Never use `console.log()`, `console.error()`, or `process.stdout.write()` directly for status messages.

## Method selection

| Situation | Method |
|-----------|--------|
| Normal status message | `out.info(msg)` |
| Something succeeded | `out.success(msg)` |
| Non-fatal issue, user should know | `out.warn(msg)` |
| Fatal / actionable failure | `out.error(msg)` |
| Secondary/contextual detail | `out.dim(msg)` |
| Diagnostic detail (shown with `-v`) | `out.verbose(msg)` |
| Deep diagnostic (shown with `-vv`) | `out.debug(msg)` |
| Start of a logical group of steps | `out.section(label)` |
| Visual separator between sub-sections | `out.divider()` |

## Verbosity gates

| Flag | Level | Methods unlocked |
|------|-------|-----------------|
| (default) | 0 | info, warn, error, success, dim, section, divider |
| `-v` | 1 | + verbose |
| `-vv` | 2 | + debug |

## Setup pattern

Every command function must receive `verbosity: number` in its options interface and create `out` locally:

```typescript
export interface MyCommandOptions {
  config: string;
  verbosity: number;  // always include this
}

export async function runMyCommand(opts: MyCommandOptions): Promise<void> {
  const out = createOut(opts.verbosity);
  out.section("⚙️ Running My Command");
  // ...
}
```

In `virage.ts`, pass `program.opts<{ verbose: number }>().verbose` as `verbosity` to every command.

## What NOT to do

```typescript
// ❌ never
console.log("Loading config...");
console.log("─".repeat(50));
process.stdout.write("Scanning... ");

// ✅ correct
out.info("Loading config...");
out.section("Scanning");  // or out.divider()
```

## Raw stdout exceptions

`console.log()` is acceptable **only** for machine-readable output (e.g., `virage query --json` emits raw JSON). Add a comment explaining why.

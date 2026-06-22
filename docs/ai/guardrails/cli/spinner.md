# Guardrail: CLI Progress & Spinner

## Rule

Any async operation that **may take longer than 2 seconds** must be wrapped with `withSpinner()` from `packages/virage-cli/src/spinner.ts`.  
Never use bare `process.stdout.write("Loading...")` / `out.success("done")` pairs.

## API

```typescript
import { withSpinner } from "../spinner.js";

const result = await withSpinner(
  "Connecting to vector store",   // label shown during spin
  () => cfg.vectorStore.initialize(),
  2000,                           // optional: threshold in ms (default: 2000)
);
```

## Behavior contract

| Timing | Output |
|--------|--------|
| fn completes before threshold | Silent — no output at all |
| fn still running at threshold | `label...` → animated Braille spinner |
| fn succeeds after spinner shown | Erase line → `✓ label (Xs)` |
| fn throws after spinner shown | Erase line → `✕ label`, error re-thrown |
| non-TTY terminal | `label...` on start, `done` / `failed` on finish |

## Which operations need `withSpinner`

Always wrap:
- Vector store `initialize()` / `readMeta()`
- Network requests (endpoint health checks, flush calls)
- Large file glob scans (when not using `PipelineRenderer`)
- Semantic search / embedding calls
- DB reads on large datasets

Never wrap:
- Synchronous operations (file reads < 1ms)
- Operations already inside `PipelineRenderer` (the `index` command manages its own progress)
- Tests / non-interactive contexts

## Do NOT use `withSpinner` inside `index`

The `index` command uses `PipelineRenderer` with three progress bars (chunking / embedding / uploading).  
Adding a `withSpinner` there will conflict with the cursor-control rendering.  
The spinner is for all **other** commands.

## Extracting shared constants

`SPINNER_FRAMES` and `ansi` live in `packages/virage-cli/src/ansi.ts`.  
Import from there — never duplicate the constant arrays.

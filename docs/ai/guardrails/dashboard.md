# Dashboard Guardrails

Apply these rules when working on `packages/virage-dashboard/` or the dashboard backend in `packages/virage-cli/src/cli/dashboard.ts`.

---

## Data flow architecture

The dashboard uses **two separate data sources**:

| Data type | Source | Why |
|-----------|--------|-----|
| Chunk text, vectors, metadata, size | **LanceDB** (via `cfg.vectorStore.listAll()`) | Authoritative — chunks live in the vector store |
| Analytics metrics, system stats | **SQLite** (`VirageDb`) | Tool-internal records not stored in LanceDB |
| Experiment runs | **SQLite** (`VirageDb`) | Eval output records |

**Fallback rule**: all endpoints fall back to SQLite when `cfg` (pipeline config) is unavailable. Never remove the fallback — the dashboard must work without an active vector store config.

**Do not** query SQLite for chunk histograms or chunk browser data. Those records in SQLite are stale by design; LanceDB is the truth.

Backend helper: `tryGetConfig(active)` in `dashboard.ts` safely loads the current project's `RAGPipelineConfig` and returns `undefined` if the config file is missing or fails to parse.

---

## VectorStore interface additions

`virage-core` declares two additions used by the dashboard:

```typescript
// New type — documents returned by listAll (no vector by default)
interface ListedDocument {
  id: string;
  denseText: string;
  sparseText: string;
  denseTextHash: string;
  sparseTextGeneratorId: string;
  metadataGeneratorId: string;
  metadata: Record<string, unknown>;
  sourceFile: string;
  commitHash: string;
  denseVector?: number[];
}

// VectorStore interface — optional method
listAll?(opts?: { limit?: number; offset?: number; includeVectors?: boolean }): Promise<ListedDocument[]>;

// VectorSearchResult extensions
sparseTextGeneratorId?: string;
metadataGeneratorId?: string;
```

`listAll` is optional — check before calling: `cfg.vectorStore.listAll?.()`. Implemented in `virage-store-lancedb`; other adapters do not implement it (SQLite fallback is used instead).

---

## SearchResult shape (REST API)

`GET /api/search` returns `SearchResult[]` with these fields (all populated from LanceDB):

```typescript
interface SearchResult {
  id: string;
  denseText: string;         // primary text field (was: content)
  sparseText: string;        // BM25 target text
  metadata: Record<string, unknown>;
  similarity: number;
  sourceFile?: string;
  sparseTextGeneratorId?: string;
  metadataGeneratorId?: string;
  content?: string;          // legacy alias for denseText — do not add new uses
}
```

Always use `denseText` in new code. `content` exists only for backward compatibility with old mock data in tests.

---

## Styling rule: Tailwind first

**Always use Tailwind utility classes** for component layout, spacing, color, and typography. Do NOT write custom CSS in `styles.css` for component-level styles.

Tailwind v4 is active: `@import "tailwindcss"` in `styles.css`, `@tailwindcss/vite` in devDependencies. Use arbitrary values freely: `bg-[#0f1b2d]`, `text-[0.8em]`, `border-[#1e3a5f]`.

Custom CSS in `styles.css` is only for:
- Global body/layout overrides (sidebar, `.main-content`, `.layout`)
- PrimeReact component overrides (`.p-datatable`, `.p-button`, etc.)
- Keyframe animations

Do NOT create new utility classes like `.result-card`, `.detail-section`, `.metadata-grid` — use Tailwind directly on the element.

---

## React component patterns

### Virtualized lists
Use `react-virtuoso` (`<Virtuoso>`) for any list that may have more than ~50 items. SearchPage results use `<Virtuoso useWindowScroll>`.

In **unit tests**, mock `react-virtuoso` to render items directly (JSDOM has no scroll metrics):
```typescript
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (i: number, item: unknown) => React.ReactNode }) =>
    <>{data.map((item, i) => itemContent(i, item))}</>,
}));
```

### DataTable vs virtualized list
- Use **PrimeReact `<DataTable>`** for structured rows with sortable columns, row selection, or expand/collapse (e.g. ExperimentsPage, analytics tables).
- Use **`<Virtuoso>`** for variable-height card lists where virtual scroll is needed (e.g. SearchPage results).

### Sort controls
Sort is applied client-side via `useMemo`. Sort state resets to default (`"similarity"`) on each new search so that results always appear in relevance order until the user explicitly changes it.

---

## WebSocket conventions

### WebSocketContext (`src/context/WebSocketContext.tsx`)

Provides:
- `status: WsStatus` — connection state
- `messages: WsMessage[]` — all messages received in the current operation
- `operationRunning: boolean` — true while an op is in flight
- `currentOp: string | null` — the op type of the in-flight operation (set by `startOp()`, cleared when operation completes)
- `startOp(payload)` — sends an op start message; records `payload.op` as `currentOp`

**Never** subscribe to raw WebSocket messages outside of `WebSocketContext`. All message accumulation happens in the context; components read `useWs()`.

### PipelineLog component

`<PipelineLog allowedOps={[...]} title? placeholder? alwaysShow? />`

| Prop | Behavior |
|------|----------|
| `allowedOps` | Only render when `currentOp` is one of these values. Pass `[]` to always show. |
| `alwaysShow` | When `true`, show the log container even before an op starts (uses `placeholder`). Set for PipelinePage; do NOT set for ExperimentsPage. |
| `placeholder` | Text shown when `alwaysShow=true` and no messages yet. |
| `title` | Optional heading rendered above the `<pre>`. |

**Op filtering rules:**
- PipelinePage: `allowedOps={["index", "eval-generate", "eval-run"]}` + `alwaysShow`
- ExperimentsPage: `allowedOps={["eval-save", "eval-run"]}` — NO `alwaysShow`
- This ensures that pipeline index/generate ops do **not** appear in the Experiments log.

**In unit tests**, provide `currentOp` in the `useWs` mock — the log will not render if `currentOp` is absent:
```typescript
vi.mock("../../context/WebSocketContext", () => ({
  useWs: () => ({ status: "connected", operationRunning: false, messages: [], currentOp: null, startOp: vi.fn() }),
}));
```

---

## ChunkHistogram empty state

`<ChunkHistogram buckets={buckets} />` renders:
- **Empty state card** when `buckets.length === 0` or all `bucket.count === 0`
- **Bar chart** (Chart.js via PrimeReact `<Chart>`) when at least one bucket has `count > 0`

The card title "Chunk Size Distribution" always renders; only the body differs.

The `canvas` API is stubbed in `src/test-setup.ts` — Chart.js renders without errors in jsdom.

---

## REST API conventions

All dashboard API endpoints live in `packages/virage-cli/src/cli/dashboard.ts`. The pattern:

```typescript
app.get("/api/<resource>", async (req, res) => {
  const cfg = await tryGetConfig(activeProject);
  if (cfg?.vectorStore?.listAll) {
    // use vector store
  } else {
    // fall back to SQLite via VirageDb
  }
});
```

- `activeProject` is a mutable reference updated by `POST /api/switch-project`
- `tryGetConfig` never throws — returns `undefined` on failure
- LanceDB queries use `listAll({ limit?, offset?, includeVectors? })` for bulk reads; `search(query, topK, opts)` for similarity search

---

## Testing conventions

### Unit tests (`src/components/__tests__/`)
- One file per component: `<Component>.test.tsx`
- Use `@testing-library/react` + `vitest`
- Wrap renders in `<PrimeReactProvider>` (required for PrimeReact components)
- Mock `api` client, `useWs`, and `useToast` — do not hit real network
- **Always include `currentOp` in the `useWs` mock** — PipelineLog checks it
- For Virtuoso: mock the module as shown above

### E2E tests (`e2e/`)
- Use Playwright; config in `playwright.config.ts`
- Dev server (`npm run dev`) must be running — `webServer` config starts it automatically
- Mock API routes with `page.route("**/api/<path>", ...)` — never hit a real backend
- Abort the WebSocket route with `page.route("**/ws", route => route.abort())`
- Run: `npm run test:e2e`

### Running tests
```bash
npm test                      # unit tests (vitest run)
npm run test:e2e              # E2E tests (playwright)
npm run type-check            # TypeScript check (includes e2e/)
```

---

## Pre-commit checklist (dashboard changes)

Run ALL three before every commit touching `packages/virage-dashboard/` or `packages/virage-cli/src/cli/dashboard.ts`:

```bash
npm run lint --workspace packages/virage-dashboard --if-present
npm run type-check -w @vivantel/virage-dashboard
npm test -w @vivantel/virage-dashboard
```

**Why not `npm run fix` at root?** The root lint glob is `packages/*/src/**/*.ts` — it excludes `.tsx` files. Dashboard components are `.tsx`, so the root lint silently misses them. The per-package `eslint src/` covers both `.ts` and `.tsx`.

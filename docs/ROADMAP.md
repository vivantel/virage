# Roadmap: @vivantel/rag-core

## Current Status
- **Current version:** 1.1.2
- **State:** Core interfaces + GitTracker + Orchestrator + CLI working
- **Provenance:** Fixed with `repository.url`
- **Release automation:** Working (release-please + trusted publisher)

---

## Version 1.2.0 — Enhanced Developer Experience

**Focus:** Making it easier to write custom chunkers and providers.

### Features

| Feature | Description | Priority |
|---------|-------------|----------|
| **CLI `init` command** | Generate `rag.config.ts` template | P0 |
| **CLI `validate` command** | Validate config without running | P0 |
| **Better error messages** | Human-readable errors with suggestions | P0 |
| **Dry-run mode** | `--dry-run` shows what would change | P1 |
| **Progress bar** | Visual feedback during long operations | P1 |
| **TypeScript examples** | More examples in docs | P1 |

### Breaking Changes
- None (minor version)

### Migration Effort
- None — fully backward compatible

### Estimated Delivery
- 2 weeks

---

## Version 1.3.0 — Production Hardening

**Focus:** Reliability, retries, and production readiness.

### Features

| Feature | Description | Priority |
|---------|-------------|----------|
| **Retry logic** | Exponential backoff for failed API calls | P0 |
| **Parallel processing** | Configurable concurrency for embeddings | P0 |
| **Resume capability** | Continue interrupted pipeline | P1 |
| **Telemetry** | Optional usage metrics (opt-in) | P2 |
| **Slack/Webhook notifications** | Notify on completion/failure | P2 |

### Technical Details

**Retry configuration:**
```typescript
options: {
  maxRetries: 3,
  retryDelayMs: 1000,
  retryBackoffFactor: 2
}
```

**Parallel processing:**
```typescript
options: {
  concurrency: 5  // parallel embedding requests
}
```

### Breaking Changes
- None

### Migration Effort
- None

### Estimated Delivery
- 3 weeks

---

## Version 2.0.0 — Plugin Ecosystem

**Focus:** Major refactor for better extensibility and separate provider packages.

### Features

| Feature | Description | Priority |
|---------|-------------|----------|
| **Separate provider packages** | Move embedders/vector stores to own packages | P0 |
| **Plugin discovery** | Auto-detect installed providers | P0 |
| **Configuration schema** | JSON Schema for `rag.config.ts` | P1 |
| **Hot reload** | Watch mode for config changes | P2 |

### Breaking Changes

| Change | Reason | Migration |
|--------|--------|-----------|
| `EmbeddingProvider` interface changed | Support streaming | Implement new methods |
| `VectorStore` interface changed | Better batch operations | Update implementations |
| Removed built-in strategies | Move to separate package | Install `@vivantel/rag-strategies` |
| CLI options renamed | Consistency | Update scripts |

### Migration Path
```bash
# Old way
import { tokenStrategy } from '@vivantel/rag-core';

# New way
npm install @vivantel/rag-strategies
import { tokenStrategy } from '@vivantel/rag-strategies';
```

### Estimated Delivery
- 4-5 weeks

---

## Separated Packages (v2.0 companion)

| Package | Description | Status |
|---------|-------------|--------|
| `@vivantel/rag-strategies` | Built-in chunking strategies | Planned |
| `@vivantel/rag-embedder-github` | GitHub Models provider | Planned |
| `@vivantel/rag-embedder-openai` | OpenAI provider | Planned |
| `@vivantel/rag-store-postgres` | PostgreSQL / pgvector store | Existing |
| `@vivantel/rag-store-pinecone` | Pinecone store | Planned |
| `@vivantel/rag-chunker-event` | Event YAML chunker (Vivantel-specific) | Planned |

---

## Questions for Clarification

### About Version 1.2.0

1. **CLI `init` command** — What should be included in the template?
   - [ ] Basic config with comments
   - [ ] Examples for common use cases
   - [ ] Links to documentation

2. **Progress bar** — Which format?
   - [ ] Simple text `[======>    ] 50%`
   - [ ] Per-file counter `Processing: 50/100 files`
   - [ ] Both

### About Version 1.3.0

3. **Retry strategy** — Which backoff?
   - [ ] Fixed delay (1s, 1s, 1s)
   - [ ] Linear (1s, 2s, 3s)
   - [ ] Exponential (1s, 2s, 4s)

4. **Telemetry** — What data to collect?
   - [ ] Anonymized usage stats (file count, duration)
   - [ ] Error reports
   - [ ] Nothing (opt-out by default)

### About Version 2.0.0

5. **Provider packages** — Should they be:
   - [ ] Under `@vivantel` scope (official)
   - [ ] Community-driven (any scope)
   - [ ] Both (official + third-party)

6. **Backward compatibility window** — How long to support v1 after v2 release?
   - [ ] 1 month
   - [ ] 3 months
   - [ ] 6 months
   - [ ] Indefinite (deprecation warnings only)

---

## Timeline Summary

| Version | Focus | Weeks | Cumulative |
|---------|-------|-------|------------|
| 1.2.0 | Developer Experience | 2 | 2 |
| 1.3.0 | Production Hardening | 3 | 5 |
| 2.0.0 | Plugin Ecosystem | 5 | 10 |

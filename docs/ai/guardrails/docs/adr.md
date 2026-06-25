# ADR Authoring Spec

All architectural decisions for this repository are stored as individual files in `docs/decisions/`.

## File naming

```
docs/decisions/ADR-NNN-short-description.md
```

`NNN` is a zero-padded three-digit number. Claim the next available number from `docs/decisions/index.md`.

## Required frontmatter

```yaml
---
id: ADR-NNN
title: Short, imperative title (≤ 10 words)
status: Proposed | Accepted | Superseded | Deprecated
date: YYYY-MM-DD
supersedes: ADR-XXX        # optional — fill when replacing another ADR
deprecated_by: ADR-XXX     # optional — fill when superseded by another ADR
related: [ADR-XXX, ADR-YYY] # optional — bidirectional cross-references
---
```

## Required sections

```markdown
## Context
## Decision
## Consequences
## Alternatives Considered
## References
```

If a section has no content, write `[Not documented in original]` — never omit the heading.

## Consequences format

Use `+` / `-` bullet prefix to signal benefit vs. trade-off:

```markdown
- **+** ...benefit...
- **−** ...trade-off...
```

## Status lifecycle

```
Proposed → Accepted → Superseded (by ADR-NNN)
                    ↘ Deprecated
```

When an ADR is superseded:
- Set `status: Superseded` and add `deprecated_by: ADR-NNN` in the old file.
- Set `supersedes: ADR-NNN` in the new file.
- Update `docs/decisions/index.md`.

## Index maintenance

After writing a new ADR, add a row to `docs/decisions/index.md`:

```
| ADR-NNN | Title | Status | One-sentence summary | [ADR-NNN](./ADR-NNN-slug.md) |
```

## Guardrails

- **One decision per file.** Do not bundle multiple decisions into a single ADR.
- **No code in the Decision section** — describe *what* and *why*, not *how*.
- **Cross-references use file links**, not anchors into a monolith.
- **Never edit the `id` field** after an ADR is Accepted — IDs are permanent identifiers.

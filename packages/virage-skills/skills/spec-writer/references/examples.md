# Spec Writer — Escalation Examples

## Example 1 — BLOCKING contradiction

```
CON-001: NOW.md claims streaming is live; NEXT.md schedules streaming as a future feature
Sources: NOW.md §Features, NEXT.md §Planned
Severity: BLOCKING
Options:
  A — Accept NOW.md as truth; remove streaming from NEXT.md §Planned
  B — Accept NEXT.md as truth; update NOW.md to mark streaming as "in progress" not "shipped"
  C — Write an ADR clarifying the actual state before updating either doc
Owners: @product-owner
```

## Example 2 — MINOR inconsistency

```
CON-002: Config field `maxRetries` described as integer in NOW.md but as string in NEXT.md schema draft
Sources: NOW.md §Configuration, NEXT.md §Schema changes
Severity: MINOR
Options:
  A — Confirm integer is correct; update NEXT.md schema draft
  B — Confirm string is intended for NEXT.md; add migration note to NOW.md
Owners: @api-owner
```

## Example 3 — Bill of health (no contradictions)

```
@spec-writer validate

✓ NOW.md and NEXT.md are consistent
✓ No open ADRs contradict shipped features
✓ All NEXT.md items have corresponding ADRs or are marked speculative

No contradictions found.
```

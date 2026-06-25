---
id: ADR-027
title: list_skills response shape change — string[] → SkillMeta[]
status: Accepted
date: 2026-06-15
---

## Context

The `list_skills` MCP tool returned a bare `string[]` of skill names. To choose the right skill, Claude had to call `read_skill` for each candidate — an O(n) round-trip chain that consumed 1,000–2,000 tokens per skill loaded. With 12 skills registered, orienting to the right skill cost up to 24 redundant tool calls in the worst case.

Separately, the new `suggest_skill` tool needed `when_to_use` metadata to perform keyword-based skill routing without any tool round-trips.

## Decision

1. **Skill SKILL.md files gain four new YAML frontmatter fields:** `when_to_use` (string[]), `prerequisites` (string[]), `estimated_tokens` (number), and `output_format` (string).

2. **`list_skills` response changes from `string[]` to a structured object:**
   ```json
   {
     "schema_version": 2,
     "names": ["analyst", "architect", ...],
     "skills": [
       {
         "name": "planner",
         "description": "...",
         "when_to_use": ["Breaking down a complex request..."],
         "prerequisites": [],
         "estimated_tokens": 1932,
         "output_format": "Plan written to docs/internal/next_plan.md",
         "has_summary": true
       }
     ]
   }
   ```
   The `names` field preserves backward compatibility. `schema_version: 2` allows future tooling to branch on format.

3. **`parseFrontmatter(content)` helper** extracts the new fields from SKILL.md using regex (no new runtime deps).

## Consequences

- **+** Claude can make skip/load/summary decisions from a single `list_skills` call instead of N `read_skill` calls.
- **+** Enables the `suggest_skill` keyword-routing tool without additional I/O.
- **+** `estimated_tokens` gives Claude a cost signal before loading a skill.
- **−** Consumers that parsed the raw `string[]` return value must be updated to read `skills[]` or `names[]`.
- **−** Frontmatter maintenance burden: authors must keep `estimated_tokens` roughly accurate as skills grow.

## Alternatives Considered

[Not documented in original]

## References

[Not documented in original]

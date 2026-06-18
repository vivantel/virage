# Skill: Spec Writer (summary)

Use when: updating NOW.md or NEXT.md after a feature ships or a plan changes; detecting contradictions between specs, ADRs, or package contracts; maintaining or reviewing SPEC.md public contracts.

**Full skill cost:** ~650 tokens. Load with `read_skill('spec-writer')` for the full spec maintenance workflow.

## Quick escalation (without loading full skill)

```
CON-NNN: <summary>
Sources: <files>
Severity: BLOCKING|MAJOR|MINOR
Options: (2-3 concrete choices)
Owners: @mentions
```

## Key outputs
- Updated NOW.md / NEXT.md / SPEC.md reflecting confirmed changes
- Contradiction report (CON-NNN format) when misalignment is found

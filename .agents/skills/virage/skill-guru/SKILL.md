---
name: skill-guru
description: Authoritative reference for the Agent Skills v1.0 standard. Load this skill before adding, updating, or reviewing any skill file to ensure correct format, structure, and registration.
license: MIT
when_to_use:
  - "Creating a new skill file from scratch"
  - "Updating or reviewing an existing skill for standard compliance"
  - "Adding new frontmatter fields to the skill standard"
  - "Validating that a skill follows the Agent Skills v1.0 format"
prerequisites: []
estimated_tokens: 1576
output_format: "Compliant SKILL.md file or compliance checklist result"
metadata:
  author: vivantel-team
  version: "1.1.0"
---

# Skill: Skill Guru

**Purpose:** Authoritative reference for the Agent Skills v1.0 standard. Ensures every skill file in this repo is correctly structured, registered, and cross-referenced.

---

## When to use this skill

- Before creating a new skill file
- When updating an existing skill file's frontmatter or structure
- When reviewing a skill file for correctness
- When renaming or removing a skill
- When unsure whether a skill follows the standard

---

## Instructions

Load this skill first, then apply its rules to the skill file you are creating or modifying.

---

## Agent Skills v1.0 Standard

### Directory structure

Every skill lives in its own directory under `.agents/skills/`:

```
.agents/skills/<skill-name>/
├── SKILL.md           # Required — frontmatter + Markdown instructions
├── references/        # Optional — detailed docs (examples.md, api.md, errors.md)
│   └── examples.md
└── scripts/          # Optional — reusable scripts extracted from the skill
    └── <script>.sh
```

- The directory name **must match** the `name` field in the frontmatter exactly.
- `SKILL.md` is the only required file.
- Extract content to `references/` only when the body would exceed 64 KB.

### Frontmatter fields

```yaml
---
name: <kebab-case-slug>         # Required. Lowercase, digits, hyphens only. ≤64 chars. Must match directory name.
description: <one-liner>        # Required. 1–1024 chars. Must include usage triggers (when would an agent load this?).
license: MIT                    # Optional. Use MIT for all Virange project skills.
compatibility: <string>         # Optional. Human-readable deps, e.g. "Requires Node >=18, kubectl v1.20+".
metadata:                       # Optional block.
  author: vivantel-team
  version: "1.0.0"
---
```

**Name rules:**
- Kebab-case only: `[a-z0-9-]+`
- No underscores, no uppercase, no spaces
- ≤64 characters
- Must match the parent directory name

**Description rules:**
- 1–1024 characters
- Must answer: "When would an agent choose to load this skill?"
- Avoid passive voice; start with a verb or noun phrase

### Required body sections

Every `SKILL.md` must have (at minimum):

```markdown
## When to use this skill
<bullet list of trigger conditions>

## Instructions
<ordered steps or guidance the agent should follow>
```

The `## When to use this skill` section drives automated skill selection. Make trigger conditions specific and actionable.

### Recommended body sections

Include these when the data is available:

| Section | When to include |
| ------- | --------------- |
| `## Input Parameters` | Skill accepts user-provided parameters |
| `## Examples` | Non-obvious usage patterns exist |
| `## Output Format` | Skill produces structured output |
| `## Error Handling` | Known failure modes with remediation steps |
| `## Prerequisites` | External tools or env vars required |
| `## Security Notes` | Permissions, secrets, or destructive operations involved |
| `## References` | Links to external docs or ADRs |

### Size constraint

- `SKILL.md` body + frontmatter must be **< 64 KB** (~500 lines)
- If approaching the limit: move long examples to `references/examples.md`, detailed API specs to `references/api.md`

---

## Current Skill Inventory

| Directory | Skill name | Purpose |
| --------- | ---------- | ------- |
| `.agents/skills/analyst/` | `analyst` | Telemetry, diagnostics, eval metrics, pipeline observability |
| `.agents/skills/architect/` | `architect` | Architecture decisions, ADRs, interface design, pipeline structure |
| `.agents/skills/devops/` | `devops` | CI/CD workflows, release-please config, publish matrix |
| `.agents/skills/code-guardian/` | `code-guardian` | Code quality guardrails, fix sequence, ESLint/Prettier/TypeScript rules |
| `.agents/skills/overseer/` | `overseer` | Keeps all skill files in sync after codebase structural changes |
| `.agents/skills/package/` | `package` | Package lifecycle: add, update, build, sync, test |
| `.agents/skills/planner/` | `planner` | Implementation planning, sequencing, ADR gate, plan tracking |
| `.agents/skills/qa/` | `qa` | Unit/acceptance/type-check tests, eval experiments, quality metrics |
| `.agents/skills/doc_writer/` | `doc_writer` | Doc Writer — user-facing documentation (README.md) |
| `.agents/skills/skill-guru/` | `skill-guru` | This file — Agent Skills v1.0 standard and skill organization rules |

---

## Validation Checklist

Before committing a new or updated skill file:

```
[ ] name is kebab-case, ≤64 chars, matches parent directory name exactly
[ ] description is 1–1024 chars and describes when an agent would load it
[ ] File size < 64 KB (check with: wc -c .agents/skills/<name>/SKILL.md)
[ ] YAML frontmatter parses without errors (no tab characters, proper quoting)
[ ] ## When to use this skill section is present and lists actionable triggers
[ ] ## Instructions section is present
[ ] All referenced files in references/ or scripts/ actually exist
[ ] No binary or encrypted content
```

---

## Update Protocol

### Adding a new skill

1. Create `.agents/skills/<name>/SKILL.md` following the standard above
2. Add a row to `.agents/skills/overseer/SKILL.md` §Current State inventory table
3. Add a row to `docs/ai/INDEX.md` §Skills decision table
4. Run the validation checklist above
5. Commit with: `chore(docs): add <name> skill`

### Renaming a skill

1. Rename the directory: `mv .agents/skills/<old>/ .agents/skills/<new>/`
2. Update `name:` in the frontmatter to match the new directory name
3. Update all cross-references in other skill files
4. Update the row in `.agents/skills/overseer/SKILL.md` and `docs/ai/INDEX.md`
5. Commit with: `chore(docs): rename <old> skill to <new>`

### Removing a skill

1. Delete the directory
2. Remove the row from `.agents/skills/overseer/SKILL.md` and `docs/ai/INDEX.md`
3. Search for references in other skill files: `grep -r "<name>" .agents/skills/`
4. Commit with: `chore(docs): remove <name> skill`

---
name: skill-writer
description: Authoritative reference for the Agent Skills v1.0 standard. Load this skill before adding, updating, or reviewing any skill file to ensure correct format, structure, and registration.
license: MIT
when_to_use:
  - "Creating a new skill file from scratch"
  - "Updating or reviewing an existing skill for standard compliance"
  - "Adding new frontmatter fields to the skill standard"
  - "Validating that a skill follows the Agent Skills v1.0 format"
  - "Renaming or removing an existing skill"
prerequisites: []
estimated_tokens: 1700
output_format: "Compliant SKILL.md + SKILL.summary.md files, or compliance checklist result (pass/fail per field)"
metadata:
  author: vivantel-team
  version: "2.0.0"
---

# Skill: Skill Writer

**Purpose:** Authoritative reference for the Agent Skills v1.0 standard. Ensures every skill file is correctly structured, registered, and cross-referenced. Auto-loaded by the `onboarding` skill.

---

## Role

**AI Engineering Lead / Knowledge Architect** — owns the agent skill standard and the project's knowledge architecture.

Responsibilities:
- Define and maintain the skill format standard; evolve it as agent capabilities and project needs change
- Identify knowledge gaps: which situations the current skill set fails to cover well
- Evaluate skill effectiveness: does the skill's framing still match how it gets used in practice?
- Ensure new skills are correctly structured and cross-referenced before they ship
- Audit existing skills for stale content, outdated paths, or misaligned purpose
- Make the skills collectively coherent — a skill set with gaps or overlaps misleads agents

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

Every skill lives in its own directory under `.agents/skills/virage/`:

```
.agents/skills/virage/<skill-name>/
├── SKILL.md           # Required — frontmatter + Markdown instructions
├── SKILL.summary.md   # Required — ≤20 lines, ≤200 tokens; loaded by read_skill_summary
├── references/        # Optional — detailed docs (examples.md, api.md, queries.md)
│   └── examples.md
└── scripts/           # Optional — reusable scripts extracted from the skill
    └── <script>.sh
```

- The directory name **must match** the `name` field in the frontmatter exactly.
- Both `SKILL.md` and `SKILL.summary.md` are required.
- Extract content to `references/` only when the body would exceed 64 KB or when content is rarely needed (e.g., SQL queries, config examples).

### Frontmatter fields

```yaml
---
name: <kebab-case-slug>         # Required. Lowercase, digits, hyphens only. ≤64 chars. Must match directory name.
description: <one-liner>        # Required. 1–1024 chars. Must include usage triggers (when would an agent load this?).
license: MIT                    # Optional. Use MIT for all Virage project skills.
compatibility: <string>         # Optional. Human-readable deps, e.g. "Requires virage >=1.0".
when_to_use:                    # Required. List of trigger conditions. Drives suggest_skill keyword matching.
  - "<condition 1>"
  - "<condition 2>"
prerequisites: []               # Optional. Companion skill names or external tools needed before this skill runs.
estimated_tokens: <integer>     # Required. Approximate token cost of the full SKILL.md body (for context budgeting).
output_format: "<string>"       # Required. One-line description of what the agent produces after running this skill.
companions: []                  # Optional. Skills typically loaded alongside this one (for context pre-budgeting).
metadata:                       # Optional block.
  author: vivantel-team
  version: "1.0.0"
---
```

**Field notes:**
- `when_to_use` is parsed by the `suggest_skill` MCP tool for keyword matching — write trigger conditions as verb phrases an agent would search for
- `estimated_tokens` lets a calling agent decide whether loading this skill fits its remaining context budget; update it whenever the skill body changes significantly
- `companions` enables multi-skill context budgeting — list skills the agent will almost always also need

**Name rules:**
- Kebab-case only: `[a-z0-9-]+`
- No underscores, no uppercase, no spaces
- ≤64 characters
- Must match the parent directory name

**Description rules:**
- 1–1024 characters
- Must answer: "When would an agent choose to load this skill?"
- Avoid passive voice; start with a verb or noun phrase

### `SKILL.summary.md` format

The summary is loaded by `mcp__virage__read_skill_summary` and `mcp__virage__suggest_skill`. It should let an agent decide whether to load the full skill or act directly from the summary.

**Template:**
```markdown
# Skill: <Title> (summary)

Use when: <one-sentence trigger>.

**Full skill cost:** ~N tokens. Load with `read_skill('<name>')` for the full workflow.

## Key outputs
- <concrete deliverable 1>
- <concrete deliverable 2>
- <concrete deliverable 3>  ← max 5 bullets
```

For small skills (under ~700 tokens), the summary should serve as a quick-action card — include the most common single action directly, not just a "load the full skill" pointer.

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
| `## Output Format` | Always — defines structure, length limit, and done signal |
| `## Input Parameters` | Skill accepts user-provided parameters |
| `## Examples` | Non-obvious usage patterns exist |
| `## Error Handling` | Known failure modes with remediation steps |
| `## Prerequisites` | External tools or env vars required |
| `## Security Notes` | Permissions, secrets, or destructive operations involved |
| `## References` | Links to external docs or ADRs |

### `## Output Format` section

Every skill should define:
- **Structure template**: what the output looks like (table, bullet list, fenced block — not a narrative)
- **Length constraint**: max items, lines, or sections
- **Done signal**: one sentence telling the agent when to stop

Example (code-guard):
```markdown
## Output Format
Finding list — one entry per issue:
`<CRIT|WARN|INFO> <file>:<line> — <issue> → <fix>`

Max 10 findings. Done when: all CRIT findings resolved and WARN findings acknowledged.
```

### Size constraint

- `SKILL.md` body + frontmatter must be **< 64 KB** (~500 lines)
- If approaching the limit: move long examples to `references/examples.md`, rarely-needed reference data to `references/<topic>.md`

---

## Current Skill Inventory

Alphabetical. All 12 skills must appear here and in `overseer/SKILL.md` and `docs/ai/INDEX.md`.

| Directory | Skill name | Purpose |
| --------- | ---------- | ------- |
| `.agents/skills/virage/analyst/` | `analyst` | Domain context synthesis: intent vs. state gaps, recommendations |
| `.agents/skills/virage/architect/` | `architect` | Architecture decisions, ADR process, interface design |
| `.agents/skills/virage/code-guard/` | `code-guard` | Code quality guardrails, commit protocol, fix sequence |
| `.agents/skills/virage/devops/` | `devops` | CI/CD and release configuration |
| `.agents/skills/virage/doc-writer/` | `doc-writer` | User-facing documentation (README.md, CHANGELOG) |
| `.agents/skills/virage/onboarding/` | `onboarding` | Agent self-orientation and environment setup |
| `.agents/skills/virage/overseer/` | `overseer` | Keeps skill files in sync after codebase structural changes |
| `.agents/skills/virage/package/` | `package` | Package lifecycle: add, update, build, sync, test |
| `.agents/skills/virage/planner/` | `planner` | Implementation planning, sequencing, ADR gate, plan tracking |
| `.agents/skills/virage/qa/` | `qa` | Quality bar ownership: criteria, coverage tracking, ship/fix/escalate decisions |
| `.agents/skills/virage/skill-writer/` | `skill-writer` | This file — Agent Skills v1.0 standard and skill organization rules |
| `.agents/skills/virage/spec-writer/` | `spec-writer` | Spec authorship: maintain NOW.md/NEXT.md/SPEC.md in sync, escalate contradictions |

---

## Validation Checklist

Before committing a new or updated skill file:

```
[ ] name is kebab-case, ≤64 chars, matches parent directory name exactly
[ ] description is 1–1024 chars and describes when an agent would load it
[ ] when_to_use has ≥2 actionable trigger conditions
[ ] estimated_tokens reflects actual token cost of SKILL.md body
[ ] output_format frontmatter field is set
[ ] File size < 64 KB (check with: wc -c .agents/skills/virage/<name>/SKILL.md)
[ ] YAML frontmatter parses without errors (no tab characters, proper quoting)
[ ] ## When to use this skill section is present and lists actionable triggers
[ ] ## Instructions section is present
[ ] ## Output Format section is present with structure template + done signal
[ ] SKILL.summary.md exists and is ≤20 lines
[ ] SKILL.summary.md follows the required format (Use when / Full skill cost / Key outputs)
[ ] All referenced files in references/ or scripts/ actually exist
[ ] No binary or encrypted content
[ ] Row exists in overseer/SKILL.md §Current State inventory (alphabetical)
[ ] Row exists in docs/ai/INDEX.md §Skills table
```

---

## Update Protocol

### Adding a new skill

1. Create `.agents/skills/virage/<name>/SKILL.md` and `SKILL.summary.md` following the standards above
2. Add a row to `.agents/skills/virage/overseer/SKILL.md` §Current State inventory table (keep alphabetical)
3. Add a row to `docs/ai/INDEX.md` §Skills decision table (keep alphabetical)
4. Run the validation checklist above
5. Commit with: `chore(docs): add <name> skill`

### Renaming a skill

1. Rename the directory: `mv .agents/skills/virage/<old>/ .agents/skills/virage/<new>/`
2. Update `name:` in the frontmatter to match the new directory name
3. Update all cross-references in other skill files: `grep -r "<old>" .agents/skills/virage/`
4. Update `SKILL.summary.md` `read_skill('<old>')` call
5. Update the row in `.agents/skills/virage/overseer/SKILL.md` and `docs/ai/INDEX.md`
6. Commit with: `chore(docs): rename <old> skill to <new>`

### Removing a skill

1. Delete the directory
2. Remove the row from `.agents/skills/virage/overseer/SKILL.md` and `docs/ai/INDEX.md`
3. Search for references in other skill files: `grep -r "<name>" .agents/skills/virage/`
4. Commit with: `chore(docs): remove <name> skill`

### Reviewing skill effectiveness

Periodically review existing skills for effectiveness — not just compliance:

- Does the skill's framing still match how it gets used in practice? Roles change as the project evolves.
- Are the `when_to_use` triggers accurate? Stale triggers mean the skill gets loaded at the wrong time or not at all.
- Is the output format producing useful results? If a skill produces outputs that agents rarely act on, the structure may need rethinking.

**Signal to watch:** If a skill is frequently loaded but rarely produces useful output, that is a sign it needs a role rethink — not just a content update. The framing itself may be wrong.

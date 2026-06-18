# Skill: Overseer (summary)

Use when: after adding/removing a package from the monorepo, after writing an ADR or changing CI, after a pipeline refactor that affects multiple skill files, when a skill references a path or command that no longer exists.

**Full skill cost:** ~1,000 tokens. Load with `read_skill('overseer')` for the full sync workflow.

## Key outputs
- Updated skill files with accurate file paths, commands, and cross-references
- Sync checklist: which skills were changed and why

# Skill: Package (summary)

Use when: adding a new package to the monorepo, updating dependencies or version, developing a new implementation of a provider interface, syncing peer dependencies after an interface change.

**Full skill cost:** ~1,100 tokens. Load with `read_skill('package')` for the full package lifecycle workflow.

## Key outputs
- New or updated package with correct workspace wiring and package.json
- Peer dependency sync across affected packages
- Done when the package builds, passes type-check, and tests pass

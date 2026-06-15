# Skill: Package (summary)

Use when: adding a new package to the monorepo, updating dependencies or version, developing a new embedder/vector-store/chunker implementation, syncing peer dependencies after an interface change.

**Full skill cost:** ~2,254 tokens. Load with `read_skill('package')` for the full package lifecycle workflow.

## Key outputs
- New or updated package with correct workspace wiring, tsconfig, and package.json
- Peer dependency sync across affected packages

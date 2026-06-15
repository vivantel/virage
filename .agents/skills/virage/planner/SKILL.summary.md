# Skill: Planner (summary)

Use when: breaking down a complex request into ordered implementation steps, creating or updating `docs/internal/next_plan.md`, tracking an in-flight implementation, surfacing design decisions that need user input.

**Full skill cost:** ~1,932 tokens. Load with `read_skill('planner')` for the full planning workflow.

## Key phases
1. Understand — restate scope, identify affected packages and files
2. Design — sequence steps in dependency order, flag decisions needed
3. Document — write plan to `docs/internal/next_plan.md` with checkbox steps
4. Execute — mark steps `[~]` in-progress, `[x]` done
5. Verify — type-check + lint + pre-commit gate passes

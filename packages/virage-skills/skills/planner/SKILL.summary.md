# Skill: Planner (summary)

Use when: breaking down a complex request into ordered implementation steps, creating or updating a plan file, tracking an in-flight implementation, surfacing design decisions that need user input.

**Full skill cost:** ~2,100 tokens. Load with `read_skill('planner')` for the full planning workflow.

## Key phases
1. Understand — restate scope, identify affected packages and files
2. Design — sequence steps in dependency order, flag decisions needed
3. Document — write plan to your project's plan file (default: `PLAN.md`) with checkbox steps
4. Execute — mark steps `[~]` in-progress, `[x]` done
5. Verify — quality gate passes, all steps [x] or [-]

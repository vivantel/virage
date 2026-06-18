# Skill: Onboarding (summary)

Use when: starting a new agent session in a Virage project, re-orienting after a gap, running `virage init` or `virage update` in a new repo.

**Full skill cost:** ~700 tokens. Load with `read_skill('onboarding')` for the full self-configuration workflow.

## Quick-action card

**Fastest onboard (MCP available):**
```
1. mcp__virage__list_skills()
2. read_skill('code-guard')
3. read_skill('planner')
4. read_skill('skill-writer')
5. For each other skill: read_skill_summary('<name>') → read_skill('<name>') only if summary shows actionable setup step
```

**Fallback (no MCP):**
```
1. Read .agents/skills/*/SKILL.summary.md (all summaries)
2. Read full skill only if summary contains: configure / create / install / remember / run / set
```

## Key outputs
- MCP server registered and hooks installed
- Active skills identified and loaded into context
- Session ready — proceed to the user's task

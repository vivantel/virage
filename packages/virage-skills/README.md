# @vivantel/virage-skills

Redistributable AI agent skills for the [Virage RAG pipeline](https://github.com/vivantel/virage).

## What's included

11 agent skill files following the [Agent Skills v1.0](./skills/skill-guru/SKILL.md) standard:

| Skill | Purpose |
|-------|---------|
| `onboarding` | Agent self-orientation — reads all skills and applies setup |
| `planner` | Implementation planning, 5-phase workflow, plan tracking |
| `architect` | Architecture decisions, ADRs, provider interfaces |
| `qa` | Unit/acceptance/type-check tests, eval workflows |
| `code-guardian` | Code quality guardrails, commit validation, fix sequence |
| `devops` | CI/CD workflows, release configuration |
| `readme` | Root README maintenance and update rules |
| `analyst` | Pipeline telemetry, vector store metrics, eval results |
| `spec-cop` | Specification coherence, contradiction detection |
| `overseer` | Keep skill files in sync with codebase changes |
| `skill-guru` | Agent Skills v1.0 standard reference |

## Installation

Skills are installed automatically when you run:

```bash
virage init
```

This copies skills to `.agents/skills/virage/` in your project and configures Claude Code hooks.

## Agent configuration

The `agent-config/hooks.json` file contains Claude Code hooks that remind the agent to check the skill-guru standard before modifying installed skill files.

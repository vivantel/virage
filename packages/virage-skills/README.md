# @vivantel/virage-skills

Redistributable AI agent skills for the [Virage RAG pipeline](https://github.com/vivantel/virage).

## What's included

12 agent skill files following the [Agent Skills v1.0](./skills/skill-writer/SKILL.md) standard:

| Skill | Purpose |
|-------|---------|
| `analyst` | Pipeline telemetry, vector store metrics, eval results |
| `architect` | Architecture decisions, ADR process, interface design |
| `code-guard` | Code quality guardrails, commit protocol, fix sequence |
| `devops` | CI/CD workflows, release configuration |
| `doc-writer` | Root README and CHANGELOG maintenance |
| `onboarding` | Agent self-orientation — discovers skills via MCP and applies setup |
| `overseer` | Keep skill files in sync with codebase changes |
| `package` | Package lifecycle: add, update, build, sync, test |
| `planner` | Implementation planning, 5-phase workflow, plan tracking |
| `qa` | Tests, eval experiments, quality metrics |
| `skill-writer` | Agent Skills v1.0 standard reference |
| `spec-writer` | Specification authorship — keep NOW/NEXT/SPEC docs in sync |

## Installation

Skills are installed automatically when you run:

```bash
virage init
```

This copies skills to `.agents/skills/virage/` in your project and configures Claude Code hooks.

## Agent configuration

The `agent-config/hooks.json` file contains Claude Code hooks that remind the agent to check the skill-writer standard before modifying installed skill files.

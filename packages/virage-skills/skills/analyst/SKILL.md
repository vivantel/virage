---
name: analyst
description: Synthesize developer intents, documentation, roadmap, and project metrics to provide domain expertise and actionable recommendations. Reads all available context — ADRs, specs, roadmap, live diagnostics — to identify gaps between stated goals and actual state.
license: MIT
when_to_use:
  - "Understanding the project's current state relative to its stated goals or roadmap"
  - "Identifying gaps between intended and actual behavior or performance"
  - "Providing expert recommendations grounded in all available project context"
  - "Diagnosing pipeline issues by cross-referencing intent, architecture decisions, and live data"
  - "Assessing whether current metrics indicate the project is on track"
prerequisites: []
estimated_tokens: 800
output_format: "Analysis report: intent vs. state comparison, identified gaps or misalignments, prioritized recommendations"
metadata:
  author: vivantel-team
  version: "3.0.0"
---

# Skill: Analyst

**Purpose:** Synthesize all available project context — documentation, ADRs, roadmap, specs, and live metrics — into expert insights and actionable recommendations. The analyst's job is not just to read numbers but to understand what they mean in the context of the project's stated goals.

---

## Role

**Domain Analyst** — owns insight generation and decision support for the project.

Responsibilities:
- Read and synthesize all available project context: intent (NEXT.md, roadmap), current state (NOW.md, metrics, code), and decisions (ADRs)
- Cross-reference sources: identify when metrics, docs, and intent tell different stories
- Identify patterns and trends, not just point-in-time readings
- Produce expert recommendations grounded in the project's stated direction
- Flag misalignments before they compound into larger problems
- Treat virage diagnostic commands as one data source among several — not as the purpose

---

## When to use this skill

- Team needs an expert opinion grounded in all available project context
- Diagnosing a problem that may have multiple contributing causes
- Evaluating whether the project is on track relative to its roadmap
- Identifying what to prioritize next based on quality, coverage, and intent

---

## Context gathering

Gather in this order — intent before state before metrics:

1. **Intent** (what the project says it's trying to do):
   - `mcp__virage__search("<topic> roadmap ADR goals intent", top_k=5)` — load relevant INDEX.md sections and ADRs
   - Fallback: read `docs/ai/INDEX.md` §Architecture state and `docs/ADR.md` directly
   - Load `spec-writer` skill summary → read `.agents/specs/NEXT.md` for planned direction

2. **Current state** (what the project is actually doing):
   - Read `.agents/specs/NOW.md` for current capabilities
   - Run virage diagnostic commands (see §Diagnostic tools below)

3. **Gaps** (where intent and state diverge):
   - Compare what's stated vs. what the data shows
   - Check recent git log for unannounced changes that haven't been reflected in docs
   - Identify what's improving vs. what's stagnating

---

## Analysis workflow

### Step 1 — Establish intent
What does the project say it wants to achieve? Pull from:
- Roadmap sections in `docs/ai/INDEX.md` or linked docs
- ADR decisions (what constraints and goals were established)
- `NEXT.md` planned features and their stated rationale

### Step 2 — Establish current state
What is actually true today? Pull from:
- `NOW.md` current capabilities
- Live virage diagnostic output (see §Diagnostic tools)
- Recent commits and PRs for untracked changes

### Step 3 — Identify gaps and form recommendations
Where do intent and state diverge?
- Metric below goal → investigate root cause, recommend intervention
- Feature in NEXT.md not progressing → surface as a blocker or scope risk
- ADR decision creating unexpected friction → flag for architect review
- Capability claimed in NOW.md not reflected in metrics → flag potential stale docs

Form recommendations in priority order: highest impact first, grounded in evidence.

---

## Diagnostic tools

These virage commands provide one data source for the analysis. Use them for the "current state" phase, not as the end goal.

```bash
virage report                    # per-stage run metrics from the most recent pipeline run
virage store stats               # vector index quality metrics (coverage, dimensionality)
virage store perf                # query latency: p50 / p95 / p99
virage chunks report             # chunk cohesion quality metrics
virage viz embeddings            # 2D visualization of the embedding space
```

**What `virage report` shows** — per-stage metrics from each pipeline run:

| Stage | Metrics captured |
| ----- | ---------------- |
| Git tracking | Duration, file count, files changed |
| Chunking | Duration, chunks produced, files processed |
| Embedding | Latency per batch, total latency, rate-limit events |
| Upload | Latency per batch, total latency, retry events |

**Verbosity flags for live investigation:**
```bash
virage index -v        # verbosity 1: basic progress
virage index -vvvvv    # verbosity 5: full debug (all provider calls, batch sizes, timings)
virage index --dry-run # show what would change without uploading
virage index --no-upload  # chunk + embed but skip vector store upload
```

**Current State — Artifact locations:**

| Artifact | Default path | Format |
| -------- | ------------ | ------ |
| Virage DB | `.virage/virage.db` | SQLite STRICT |

Override: set `VIRAGE_DIR` env var to change the `.virage/` root.

For direct SQLite inspection, see `references/queries.md`.

For eval metric interpretation (MRR, P@5, R@10, HitRate@5): see the `qa` skill.

---

## Output Format

Analysis report:

```
## Analysis: <topic>

**Intent** (from docs/roadmap/ADRs): <one sentence>
**Current state** (from metrics/NOW.md/code): <one sentence>
**Gap**: <what is missing or misaligned, or "none identified">

Findings:
- <finding 1> [source: <doc or command>]
- <finding 2> [source: <doc or command>]

Recommendations:
1. <highest priority action> — <one sentence rationale>
2. <next action> — <one sentence rationale>
```

Done when: intent and state have both been established from sources, gaps are identified or explicitly confirmed absent, and at least one concrete recommendation is provided — or "insufficient data" is declared with the specific missing source named.

# Virage Use Cases

This document explains how Virage's RAG pipeline translates to concrete developer and team wins. Each scenario covers the problem, how Virage addresses it, and the measurable benefit.

---

## 1. Onboarding a new engineer without drowning them in docs

**The problem.** A developer joins a team with 200k lines of code and 800 markdown files. They spend their first two weeks asking "where is the X logic?" in Slack. Senior engineers get interrupted; the new hire gets slowed down.

**How Virage helps.** Index the codebase and docs once. The new developer's AI assistant (Claude Code, Copilot, Codex) searches the live index for answers. AST-aware chunking means function signatures, docstrings, and scope chains are embedded together — a search for "how does session expiry work" returns the actual implementation chunk, not a generic docs page.

```bash
# Team runs once, checks virage.config.json and .virage/ into git
virage index

# New developer, day one — no setup required
/rag how does session expiry work
```

**What changes.** The assistant returns the relevant function from `auth/session-manager.ts` alongside the config value in `config/defaults.yaml` in a single query. The developer reads code directly instead of asking in Slack.

**Token efficiency.** Because the index is incremental, only changed files are re-embedded on each push. The index stays current without any per-developer setup or any CI cost proportional to repo size.

---

## 2. AI code review with full codebase context

**The problem.** An AI agent reviewing a pull request only sees the diff. It can't say "this change breaks the contract assumed in `services/billing.ts` line 47" because it doesn't know that file exists.

**How Virage helps.** The MCP server gives the reviewer semantic access to the entire indexed codebase. Before flagging a concern, the agent searches for all callers of the changed interface, finds relevant tests, and checks whether similar patterns already exist elsewhere.

```
# Claude Code, reviewing PR #312
/review

# Agent internally calls:
mcp__virage__search("PaymentService interface contract")
mcp__virage__search("processPayment callers")
```

**What changes.** The reviewer catches that two other services depend on the method signature being changed, and flags the breakage in its review comment. Without the index, it would have reviewed only what was in the diff.

**Performance note.** Search latency is under 10ms for a 50k-chunk index on LanceDB. The agent completes its context-gathering phase in 2–3 tool calls before writing the review.

---

## 3. Keeping documentation in sync with code

**The problem.** Documentation drifts. A function gets renamed, the README still refers to the old name. Nobody notices until a new user files a bug.

**How Virage helps.** The git-aware pipeline re-indexes changed files within seconds of a commit. The AI assistant's next search returns updated content. Additionally, the `/doc` skill uses the index to find which docs sections reference recently changed code.

```bash
# git post-commit hook (installed by virage install-hooks)
# Runs virage index automatically after every commit
```

**In the AI workflow:**

```
/doc
# Doc writer skill searches the index for "parseConfig" (the renamed function)
# Finds all markdown sections that mention the old name
# Proposes targeted edits
```

**What changes.** Documentation stays within one commit of the code. The cost of keeping it current drops from "requires a dedicated doc review" to "the agent flags it in the same session."

---

## 4. Zero-cost local RAG for private codebases

**The problem.** A team can't send their codebase to a cloud embedding API. Legal says no; the code contains unreleased IP. Most RAG tools require an API key.

**How Virage helps.** The local-first stack requires zero external services:

```json
{
  "embedder": {
    "package": "@vivantel/virage-embedder-fastembed",
    "config": { "model": "BAAI/bge-small-en-v1.5", "dimensions": 384 }
  },
  "vectorStore": {
    "package": "@vivantel/virage-store-lancedb",
    "config": { "uri": ".virage/lancedb" }
  }
}
```

FastEmbed runs ONNX inference locally. LanceDB is a file embedded in the repo's `.virage/` directory. No data leaves the machine.

**Performance.** On an M2 MacBook: ~80 chunks/second embedding throughput. A 50,000-chunk codebase indexes in under 12 minutes on first run, under 30 seconds on incremental runs.

**What changes.** The team gets full semantic search over proprietary code with no API costs, no data exposure, and no infrastructure to manage.

---

## 5. Multi-strategy indexing for mixed content repos

**The problem.** A monorepo contains TypeScript source, Markdown docs, YAML configs, and Python scripts. A single chunking strategy produces poor results: token-splitting destroys docstrings; heading-based splitting is wrong for code; whole-file is too coarse for long docs.

**How Virage helps.** Multiple chunkers run in parallel, each targeting the file types it handles best:

```json
{
  "chunkers": [
    { "patterns": ["**/*.md"],           "strategy": "markdownHeaders" },
    { "patterns": ["src/**/*.ts"],       "strategy": "codeChunkAst" },
    { "patterns": ["**/*.py"],           "strategy": "codeChunkAst" },
    { "patterns": ["**/*.yaml", "**/*.json"], "strategy": "wholeFile" }
  ]
}
```

The AST-aware chunker for TypeScript preserves class/method boundaries and embeds the scope chain (`MyClass > myMethod > callback`) as metadata. A search for "database connection retry" returns the relevant method, not a random mid-function slice.

**What changes.** Retrieval quality is substantially higher for mixed repos because each file type is chunked at its natural semantic boundaries.

---

## 6. Measuring and improving retrieval quality over time

**The problem.** A team switches from OpenAI `text-embedding-3-small` to a local model to cut costs. They don't know if retrieval quality degraded. Gut feel is not enough.

**How Virage helps.** The evaluation suite gives a before/after measurement:

```bash
# Baseline run with current embedder
virage experiment run --name openai-small

# Switch embedder in config, re-index
virage index --force

# Measure again
virage experiment run --name fastembed-bge

# Statistical comparison
virage experiment compare openai-small fastembed-bge
# → MRR: 0.71 vs 0.68 (p=0.04, not significant at α=0.01)
# → Precision@5: 0.74 vs 0.72 (p=0.21, not significant)
# → Conclusion: FastEmbed is statistically equivalent at 1/10th the cost
```

The bootstrap significance test prevents false conclusions from small eval sets. "Not significant" here is the right answer: save the money.

**What changes.** Infrastructure decisions are data-driven. Teams can tune chunking strategy, overlap, model, and batch size with confidence, not guesswork.

---

## 7. CI pipeline with cost-bounded indexing

**The problem.** A CI job runs `virage index` on every PR. Large PRs occasionally touch many files and trigger expensive embedding API calls. The team wants a budget cap.

**How Virage helps.** The incremental design means most CI runs are cheap — only the files changed in the PR flow through the embedder. The pipeline respects `rateLimitMs` and `batchSize` to avoid rate-limit errors.

For teams who want explicit control:

```bash
# Only chunk, don't embed — zero API cost
virage index --no-upload

# See what would run before committing
virage index --dry-run
```

Upcoming: `virage estimate` will show projected token count and cost before any API call is made, enabling cost-gated CI steps.

**What changes.** Indexing costs scale with the size of changes, not the size of the repo. A 3-file PR costs approximately the same as 3-file PR regardless of whether the repo has 500 or 50,000 files.

---

## 8. Agent workflow automation with skills

**The problem.** Each time an AI agent starts a new session, it re-derives the same project context: what are the packages, what are the naming conventions, how do I run tests. This burns tokens and time on every session.

**How Virage helps.** The skills system ships pre-written, versioned workflows for common developer tasks. The agent loads a summary (≤150 tokens) to decide if a skill is relevant, then loads the full skill only when needed.

```
/plan         → loads planner skill (breaks down implementation into ordered steps)
/review       → loads code-guardian skill (correctness, security, quality checklist)
/doc          → loads doc_writer skill (README section map, update checklist)
/arch         → loads architect skill (ADR gate, decision record format)
```

Skills are updated alongside code via `virage update`. When a convention changes, the skill changes in the same PR — agents in the next session automatically use the updated workflow.

**Token savings.** Loading a skill summary before committing to the full content saves ~1,500 tokens per skill selection decision. In a session that touches 4 different skills, that's ~6,000 tokens saved before any actual work begins.

---

## 9. Multi-agent pipeline across different AI tools

**The problem.** A team uses Claude Code for development, GitHub Copilot for inline editing, and OpenAI Codex in CI. Each tool has its own context — they can't share project knowledge.

**How Virage helps.** A single `virage index` run populates a shared vector store. Each agent integration reads from the same index via its own plugin:

```bash
virage init
# → Select: Claude Code, GitHub Copilot, OpenAI Codex
# Writes: .claude/skills/virage-agent/, .github/copilot/, .codex/
```

All three agents query the same MCP server or native integration. A knowledge update (new package added, architecture decision recorded) is immediately available to all agents on the next search.

**What changes.** Project knowledge isn't fragmented by tool. An architecture decision recorded in the ADR by the Claude agent is found by the Copilot agent reviewing related code the next day.

---

## 10. Debugging why search returns the wrong results

**The problem.** An agent keeps returning the wrong chunk for a well-known function. The team doesn't know if it's a chunking problem, an embedding model problem, or just a bad query.

**How Virage helps.** The diagnostic suite isolates the cause:

```bash
# Is the chunk even in the index?
virage store stats
mcp__virage__list_source_files

# What does the chunk look like?
mcp__virage__list_chunks --source-file src/auth/session.ts

# How are chunks distributed? Is one strategy producing giant chunks?
virage chunks report

# Is the embedding space well-distributed?
virage viz embeddings   # 2D PCA/t-SNE visualization
virage store stats      # intrinsic dimension, outlier fraction, ANN recall@10

# Run a structured eval to quantify the issue
virage eval-generate    # auto-generate test queries from current chunks
virage evaluate         # measure precision@5, MRR, hit rate
```

The combination of chunk inspection, embedding quality metrics, and eval results usually localizes the problem to one of: chunk is too large (→ reduce `maxChunkSize`), chunk is split at the wrong boundary (→ switch from `token` to `codeChunkAst`), or embedding model is undertrained on this domain (→ try a different model via `virage experiment`).

**What changes.** Retrieval problems become diagnosable in under 15 minutes instead of requiring intuition or trial-and-error over days.

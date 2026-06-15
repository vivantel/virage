/**
 * Evaluates skill routing accuracy for the suggest_skill keyword-matching logic.
 * Tests both the MCP tool's keyword scoring and the UserPromptSubmit hook's
 * grep-pattern detection, using a labeled dataset of (query → expected_skill) pairs.
 */

export interface SkillRoutingQuery {
  query: string;
  expectedSkill: string;
  /** Whether the UserPromptSubmit hook should fire for this query */
  shouldTriggerHook: boolean;
}

export interface SkillRoutingEvalResult {
  totalQueries: number;
  correctSkillSelected: number;
  accuracy: number;
  hookTruePositives: number;
  hookFalsePositives: number;
  hookTruePositiveRate: number;
  hookFalsePositiveRate: number;
  /** Average tokens saved by using summary path vs full skill load */
  avgTokensSaved: number;
}

interface SkillMeta {
  name: string;
  when_to_use: string[];
  estimated_tokens: number;
}

/** Mirrors the keyword-scoring logic in virage-agent-claude/src/server.ts */
function scoreSkill(task: string, skill: SkillMeta): number {
  const taskLower = task.toLowerCase();
  const haystack = [skill.name, ...skill.when_to_use].join(" ").toLowerCase();
  const words = taskLower.split(/\s+/).filter((w) => w.length > 2);
  const hits = words.filter((w) => haystack.includes(w)).length;
  const nameBonus =
    taskLower.includes(skill.name.replace("-", " ")) ||
    taskLower.includes(skill.name)
      ? 2
      : 0;
  return hits + nameBonus;
}

/** Mirrors the grep patterns in the UserPromptSubmit hook */
function hookWouldFire(query: string): boolean {
  const q = query.toLowerCase();
  return (
    /\b(plan|break.?down|roadmap|sequence|implement.?steps)\b/.test(q) ||
    /\b(adr|architect|interface.?design|system.?design|refactor.?scope)\b/.test(
      q,
    ) ||
    /\b(docs?|readme|changelog|document|write.?up)\b/.test(q) ||
    /\b(review|security|vulnerabilit|audit)\b/.test(q)
  );
}

export class SkillRoutingEvaluator {
  constructor(
    private readonly skills: SkillMeta[],
    private readonly summaryTokens = 150,
  ) {}

  evaluate(queries: SkillRoutingQuery[]): SkillRoutingEvalResult {
    let correct = 0;
    let hookTP = 0;
    let hookFP = 0;
    let totalTokensSaved = 0;
    let hookShouldFireCount = 0;
    let hookShouldNotFireCount = 0;

    for (const { query, expectedSkill, shouldTriggerHook } of queries) {
      const scored = this.skills
        .map((s) => ({ name: s.name, score: scoreSkill(query, s) }))
        .sort((a, b) => b.score - a.score);

      const top = scored[0];
      if (top && top.score > 0 && top.name === expectedSkill) {
        correct++;
        const fullTokens =
          this.skills.find((s) => s.name === expectedSkill)?.estimated_tokens ??
          0;
        totalTokensSaved += Math.max(0, fullTokens - this.summaryTokens);
      }

      const fired = hookWouldFire(query);
      if (shouldTriggerHook) {
        hookShouldFireCount++;
        if (fired) hookTP++;
      } else {
        hookShouldNotFireCount++;
        if (fired) hookFP++;
      }
    }

    const total = queries.length;
    return {
      totalQueries: total,
      correctSkillSelected: correct,
      accuracy: total > 0 ? correct / total : 0,
      hookTruePositives: hookTP,
      hookFalsePositives: hookFP,
      hookTruePositiveRate:
        hookShouldFireCount > 0 ? hookTP / hookShouldFireCount : 0,
      hookFalsePositiveRate:
        hookShouldNotFireCount > 0 ? hookFP / hookShouldNotFireCount : 0,
      avgTokensSaved: correct > 0 ? totalTokensSaved / correct : 0,
    };
  }
}

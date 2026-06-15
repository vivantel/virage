/**
 * Unified ecosystem evaluator: combines retrieval metrics (precision@K, recall@K, MRR),
 * RAGAS quality metrics (faithfulness, answerRelevance, contextRecall), and
 * skill-routing accuracy (suggest_skill keyword matching + hook detection).
 */

import type { EmbeddingProvider, VectorStore } from "../interfaces/index.js";
import type {
  EvalDataset,
  RAGASResult,
  LLMJudge,
} from "../interfaces/quality.js";
import type { EvalResult } from "../interfaces/quality.js";
import { EvalRunner } from "./runner.js";
import { RAGASRunner } from "./ragas.js";
import {
  SkillRoutingEvaluator,
  type SkillRoutingQuery,
  type SkillRoutingEvalResult,
} from "./skill-routing-eval.js";

export interface EcosystemEvalDataset {
  /** Retrieval evaluation: (query → relevant chunk IDs) */
  retrieval: EvalDataset;
  /** RAGAS evaluation: (query + ground truth) — requires LLM judge */
  ragas?: EvalDataset;
  /** Skill routing evaluation: (query → expected skill + hook flag) */
  skillRouting: SkillRoutingQuery[];
}

export interface EcosystemEvalResult {
  retrieval: EvalResult;
  ragas: RAGASResult | null;
  skillRouting: SkillRoutingEvalResult;
  timestamp: string;
  configSnapshot: Record<string, unknown>;
}

interface SkillMetaForEval {
  name: string;
  when_to_use: string[];
  estimated_tokens: number;
}

export class EcosystemEvaluator {
  constructor(
    private readonly store: VectorStore,
    private readonly embedder: EmbeddingProvider,
    private readonly skills: SkillMetaForEval[],
    private readonly judge?: LLMJudge,
    private readonly topK = 10,
  ) {}

  async run(
    dataset: EcosystemEvalDataset,
    configSnapshot: Record<string, unknown> = {},
  ): Promise<EcosystemEvalResult> {
    const retrievalRunner = new EvalRunner(
      this.store,
      this.embedder,
      dataset.retrieval,
      this.topK,
    );
    const { evalResult: retrieval } = await retrievalRunner.run();

    let ragas: RAGASResult | null = null;
    if (this.judge && dataset.ragas) {
      const ragasRunner = new RAGASRunner(
        this.judge,
        this.store,
        this.embedder,
        dataset.ragas,
        this.topK,
      );
      ragas = await ragasRunner.run();
    }

    const routingEval = new SkillRoutingEvaluator(this.skills);
    const skillRouting = routingEval.evaluate(dataset.skillRouting);

    return {
      retrieval,
      ragas,
      skillRouting,
      timestamp: new Date().toISOString(),
      configSnapshot,
    };
  }
}

export function printEcosystemEvalResult(result: EcosystemEvalResult): void {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  console.log("\n📊 Ecosystem Evaluation Results");
  console.log("═".repeat(50));

  console.log("\n🔍 Retrieval Metrics");
  console.log("─".repeat(40));
  console.log(`  Queries evaluated : ${result.retrieval.queriesEvaluated}`);
  console.log(`  Precision@5       : ${pct(result.retrieval.precisionAt5)}`);
  console.log(`  Precision@10      : ${pct(result.retrieval.precisionAt10)}`);
  console.log(`  Recall@10         : ${pct(result.retrieval.recallAt10)}`);
  console.log(`  MRR               : ${result.retrieval.mrr.toFixed(4)}`);
  console.log(`  HitRate@5         : ${pct(result.retrieval.hitRateAt5)}`);

  if (result.ragas) {
    console.log("\n⚖️  RAGAS Quality Metrics");
    console.log("─".repeat(40));
    console.log(`  Faithfulness      : ${pct(result.ragas.faithfulness)}`);
    console.log(`  Answer Relevance  : ${pct(result.ragas.answerRelevance)}`);
    console.log(`  Context Recall    : ${pct(result.ragas.contextRecall)}`);
  } else {
    console.log("\n⚖️  RAGAS: skipped (no LLM judge configured)");
  }

  const r = result.skillRouting;
  console.log("\n🧭 Skill Routing Metrics");
  console.log("─".repeat(40));
  console.log(`  Queries evaluated : ${r.totalQueries}`);
  console.log(`  Routing accuracy  : ${pct(r.accuracy)}`);
  console.log(`  Hook TPR          : ${pct(r.hookTruePositiveRate)}`);
  console.log(`  Hook FPR          : ${pct(r.hookFalsePositiveRate)}`);
  console.log(`  Avg tokens saved  : ${Math.round(r.avgTokensSaved)} tok`);

  console.log("\n═".repeat(50));
}

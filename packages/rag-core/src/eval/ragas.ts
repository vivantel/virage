import type {
  EmbeddingProvider,
  VectorStore,
} from "../interfaces/index.js";
import type {
  EvalDataset,
  LLMJudge,
  RAGASResult,
} from "../interfaces/quality.js";

export class RAGASRunner {
  constructor(
    private readonly judge: LLMJudge,
    private readonly store: VectorStore,
    private readonly embedder: EmbeddingProvider,
    private readonly dataset: EvalDataset,
    private readonly topK = 10,
  ) {}

  async run(): Promise<RAGASResult> {
    let totalFaithfulness = 0;
    let totalAnswerRelevance = 0;
    let totalContextRecall = 0;
    let evaluated = 0;

    for (const evalQuery of this.dataset.queries) {
      if (!evalQuery.groundTruth) continue;

      const embedding = await this.embedder.embed(evalQuery.query);
      const results = await this.store.search(embedding, this.topK);
      const contexts = results.map((r) => r.content);

      const scores = await this.judge.evaluate(
        evalQuery.query,
        contexts,
        evalQuery.groundTruth,
      );

      totalFaithfulness += scores.faithfulness;
      totalAnswerRelevance += scores.answerRelevance;
      totalContextRecall += scores.contextRecall;
      evaluated++;
    }

    if (evaluated === 0) {
      return { faithfulness: 0, answerRelevance: 0, contextRecall: 0 };
    }

    return {
      faithfulness: totalFaithfulness / evaluated,
      answerRelevance: totalAnswerRelevance / evaluated,
      contextRecall: totalContextRecall / evaluated,
    };
  }
}

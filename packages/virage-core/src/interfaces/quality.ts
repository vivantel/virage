/**
 * Shared quality metric types used across all rag-* packages.
 */

// ---------------------------------------------------------------------------
// Chunk quality
// ---------------------------------------------------------------------------

export interface ChunkQualityMetrics {
  /** Mean content length in characters */
  avgChunkSize: number;
  /** Population standard deviation of content length */
  stdDevChunkSize: number;
  /**
   * Fraction of chunks that end with a sentence-terminating character
   * (`.`, `!`, `?`, or `\n`). Range 0–1; higher is better.
   */
  semanticCoherence: number;
  /**
   * Mean ratio of unique tokens to total tokens per chunk.
   * Tokenised by whitespace+punctuation split. Range 0–1; lower may indicate
   * repetitive content.
   */
  informationDensity: number;
}

// ---------------------------------------------------------------------------
// Embedding quality
// ---------------------------------------------------------------------------

export interface EmbeddingMetrics {
  /**
   * Estimated intrinsic dimensionality via the TWO-NN estimator.
   * A value much lower than `dimensions` suggests the embedding space is
   * under-utilised for this corpus.
   */
  intrinsicDimension: number;
  /**
   * Mean cosine similarity between randomly sampled pairs of embeddings.
   * Should be close to 0 for a well-spread embedding space.
   */
  avgCosineSimRandomPairs: number;
  /**
   * Fraction of embeddings whose L2-norm z-score exceeds 2.5.
   * Non-zero values may indicate degenerate or truncated inputs.
   */
  outlierFraction: number;
}

// ---------------------------------------------------------------------------
// Vector store index quality
// ---------------------------------------------------------------------------

export interface IndexStats {
  totalVectors: number;
  indexType: "ivfflat" | "hnsw" | "flat" | "unknown";
  /** Fraction of top-10 exact results also returned by the ANN index. */
  annRecallAt10: number;
  /** Age of the index in hours since last VACUUM / last rebuild. */
  indexAgeHours: number;
  /**
   * Fraction of dead tuples: n_dead_tup / (n_live_tup + n_dead_tup).
   * Values above 0.1 warrant a REINDEX.
   */
  deadTupleFraction: number;
  /** Human-readable maintenance suggestions. */
  suggestions: string[];
}

export interface QueryPerfReport {
  timeframeHours: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  /** Number of queries that took more than 100 ms. */
  slowQueryCount: number;
  suggestedIndexes: string[];
}

// ---------------------------------------------------------------------------
// Evaluation metrics
// ---------------------------------------------------------------------------

export interface EvalResult {
  precisionAt5: number;
  precisionAt10: number;
  recallAt10: number;
  /** Mean Reciprocal Rank */
  mrr: number;
  hitRateAt5: number;
  queriesEvaluated: number;
}

export interface RAGASResult {
  /** 0–1: does the answer stick to the retrieved contexts? */
  faithfulness: number;
  /** 0–1: is the answer on-topic for the query? */
  answerRelevance: number;
  /** 0–1: do the retrieved contexts cover the ground-truth answer? */
  contextRecall: number;
}

// ---------------------------------------------------------------------------
// Experiment tracking
// ---------------------------------------------------------------------------

export interface ExperimentRun {
  /** `<name>_<iso-timestamp>` */
  id: string;
  name: string;
  timestamp: string;
  config: Record<string, unknown>;
  evalResult: EvalResult;
  ragasResult?: RAGASResult;
  /** Per-query reciprocal-rank scores for bootstrap significance testing. */
  perQueryRrScores?: number[];
}

// ---------------------------------------------------------------------------
// Evaluation dataset
// ---------------------------------------------------------------------------

export interface EvalQuery {
  query: string;
  /** Match against chunk.denseTextHash (preferred). */
  expectedChunkIds?: string[];
  /** Substring match fallback when denseTextHash is unavailable. */
  expectedContent?: string[];
  /** Expected answer text — required for RAGAS metrics. */
  groundTruth?: string;
}

export interface EvalDataset {
  queries: EvalQuery[];
  version?: string;
}

// ---------------------------------------------------------------------------
// LLM judge interface (used by RAGAS runner)
// ---------------------------------------------------------------------------

export interface LLMJudge {
  readonly name: string;
  evaluate(
    query: string,
    contexts: string[],
    groundTruth: string,
  ): Promise<{
    faithfulness: number;
    answerRelevance: number;
    contextRecall: number;
  }>;
}

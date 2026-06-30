/**
 * QualityRunner — orchestrates all 8 pipeline component metric collections.
 *
 * Loads config, samples chunks from VirageDb, runs each component's metrics
 * in dependency order, aggregates scores, and returns a QualityReport.
 * Optional components (5-8) are skipped gracefully when not configured.
 */

import type {
  QualityReport,
  QualityRunnerOptions,
  ComponentResult,
  MustPassGate,
  MetricResult,
  RagBenchSummary,
} from "./interfaces.js";
import { loadRagBenchDataset, RagBenchEvaluator } from "../eval/ragbench.js";
import {
  aggregateComponent,
  aggregateOverall,
  computeStatus,
} from "./scoring.js";
import { computeChunkingMetrics } from "./metrics/chunking.js";
import { computeMetadataMetrics } from "./metrics/metadata.js";
import { computeDenseInputMetrics } from "./metrics/dense-input.js";
import { computeDenseEmbeddingMetrics } from "./metrics/dense-embedding.js";
import { computeSparseInputMetrics } from "./metrics/sparse-input.js";
import { computeLexicalRetrievalMetrics } from "./metrics/lexical-retrieval.js";
import { computeRerankerInputMetrics } from "./metrics/reranker-input.js";
import { computeRerankerMetrics } from "./metrics/reranker.js";
import { loadConfig } from "../config-loader.js";
import { VirageDb } from "../core/virage-db.js";
import { defaultVirageDb } from "../core/virage-defaults.js";
import type { Chunk } from "../interfaces/index.js";

// Component total weights used for overall aggregation
const COMPONENT_WEIGHTS: Record<string, number> = {
  chunking: 2.0 + 2.0 + 0.5 + 1.0, // sum of metric weights
  metadata: 1.0 + 1.0 + 1.0 + 1.0 + 0.5,
  denseInput: 1.0 + 1.0,
  denseEmbedding: 3.0 + 1.0 + 1.0 + 0.5 + 1.0,
  sparseInput: 1.0 + 0.5,
  lexicalRetrieval: 1.5,
  rerankerInput: 1.0 + 1.0 + 0.5 + 1.0,
  reranker: 2.5 + 1.0 + 0.5,
};

function collectMustPassGates(components: ComponentResult[]): MustPassGate[] {
  const gates: MustPassGate[] = [];
  for (const comp of components) {
    for (const m of comp.metrics) {
      if (m.mustPass && !m.skipped && m.mustPassPassed !== undefined) {
        gates.push({
          metricName: m.name,
          threshold: m.mustPassThreshold ?? 0,
          value: m.rawValue,
          passed: m.mustPassPassed,
        });
      }
    }
  }
  return gates;
}

function metricsToComponent(
  id: string,
  label: string,
  metrics: MetricResult[],
  componentWeight: number,
  skipped = false,
  skipReason?: string,
): ComponentResult {
  const score = aggregateComponent(metrics);
  return {
    id: id as ComponentResult["id"],
    label,
    score,
    weight: componentWeight,
    skipped,
    skipReason,
    metrics,
  };
}

function sampleArray<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
}

export async function runQualityAssessment(
  opts: QualityRunnerOptions,
): Promise<QualityReport> {
  const t0 = Date.now();
  const {
    configFile,
    sampleSize,
    topK,
    failFast,
    ragBenchPath,
    thresholdOverrides = {},
    weightOverrides = {},
  } = opts;

  const cfg = await loadConfig(configFile);

  // Merge config.quality thresholds/weights into options (CLI flags take precedence)
  const qualityCfg = cfg.quality;
  const resolvedThresholds = {
    ...qualityCfg?.thresholds,
    ...thresholdOverrides,
  };
  const resolvedWeights = { ...qualityCfg?.weights, ...weightOverrides };

  await cfg.vectorStore.initialize();

  const db = new VirageDb(defaultVirageDb());
  let allChunks: Chunk[];
  try {
    allChunks = db.getAllChunks();
  } finally {
    db.close();
  }

  if (allChunks.length === 0) {
    throw new Error("No chunks found in virage.db — run `virage index` first.");
  }

  const sample = sampleArray(allChunks, sampleSize);
  const chunkIdSet = new Set(allChunks.map((c) => c.denseTextHash));

  // Dense search function wrapper
  const searchFn = async (query: string, k: number) => {
    const embed = await cfg.embedder.embed(query);
    const results = await cfg.vectorStore.search(embed, k);
    return results.map((r) => ({ id: r.id }));
  };

  // Lexical (FTS) search — attempt hybrid with alpha=0 (pure BM25)
  let ftsSearchFn:
    | ((q: string, k: number) => Promise<Array<{ id: string }>>)
    | null = null;
  try {
    const testEmbed = await cfg.embedder.embed("test");
    await cfg.vectorStore.search(testEmbed, 1, undefined, {
      hybrid: true,
      hybridAlpha: 0,
      queryText: "test",
    });
    ftsSearchFn = async (query: string, k: number) => {
      const embed = await cfg.embedder.embed(query);
      const results = await cfg.vectorStore.search(embed, k, undefined, {
        hybrid: true,
        hybridAlpha: 0,
        queryText: query,
      });
      return results.map((r) => ({ id: r.id }));
    };
  } catch {
    // Vector store doesn't support hybrid/FTS — lexical component will be skipped
  }

  // Reranker availability
  const rerankerAvailable = cfg.search?.reranker != null;

  const components: ComponentResult[] = [];

  // ─── Component 1: Chunking ────────────────────────────────────────────────
  const chunkingMetrics = await computeChunkingMetrics(
    {
      chunks: sample.map((c) => ({
        denseText: c.denseText,
        sparseText: c.sparseText,
        metadata: {
          astNodeCount: undefined,
          astNodeCountInBounds: undefined,
          tokenCount: c.metadata?.estimatedTokens,
        },
      })),
      embedFn: (t) => cfg.embedder.embed(t),
      tokenRangeMin: 50,
      tokenRangeMax: 512,
    },
    Math.min(50, sampleSize),
    resolvedWeights,
  );
  components.push(
    metricsToComponent(
      "chunking",
      "Chunking",
      chunkingMetrics,
      COMPONENT_WEIGHTS.chunking,
    ),
  );

  if (
    failFast &&
    components.some((c) => c.metrics.some((m) => m.mustPassPassed === false))
  ) {
    return buildReport(t0, components, sampleSize, topK, configFile, undefined);
  }

  // ─── Component 2: Metadata ────────────────────────────────────────────────
  const metadataMetrics = computeMetadataMetrics(
    {
      chunks: sample.map((c) => ({
        metadata: {
          id: c.denseTextHash,
          breadcrumb: Array.isArray(c.metadata?.breadcrumb)
            ? c.metadata.breadcrumb.join(" > ")
            : undefined,
          fqn: c.metadata?.fqn,
          imports: c.metadata?.imports,
          resolvedImports: undefined,
          totalImports: c.metadata?.imports?.length,
          prevId: c.metadata?.siblingPrev,
          nextId: c.metadata?.siblingNext,
          sourceFile: c.metadata?.sourceFile,
          isCode: !!c.metadata?.codeLanguage,
        },
        denseText: c.denseText,
      })),
      chunkIdSet,
    },
    resolvedThresholds["importResolution"] ?? 0.7,
    resolvedWeights,
  );
  components.push(
    metricsToComponent(
      "metadata",
      "Metadata Extraction",
      metadataMetrics,
      COMPONENT_WEIGHTS.metadata,
    ),
  );

  if (
    failFast &&
    components.some((c) => c.metrics.some((m) => m.mustPassPassed === false))
  ) {
    return buildReport(t0, components, sampleSize, topK, configFile, undefined);
  }

  // ─── Component 3: Dense Input ─────────────────────────────────────────────
  const denseInputMetrics = await computeDenseInputMetrics(
    {
      chunks: sample.map((c) => ({
        denseText: c.denseText,
        sparseText: c.sparseText,
      })),
      embedFn: (t) => cfg.embedder.embed(t),
    },
    Math.min(30, sampleSize),
    resolvedWeights,
  );
  components.push(
    metricsToComponent(
      "denseInput",
      "Dense Input Prep",
      denseInputMetrics,
      COMPONENT_WEIGHTS.denseInput,
    ),
  );

  // ─── Component 4: Dense Embedding ─────────────────────────────────────────
  const denseEmbeddingMetrics = await computeDenseEmbeddingMetrics(
    {
      chunks: sample.map((c) => ({
        id: c.denseTextHash,
        denseText: c.denseText,
      })),
      searchFn,
      embedFn: (t) => cfg.embedder.embed(t),
      topK,
    },
    Math.min(sampleSize, 200),
    resolvedThresholds["selfRecall"] ?? 0.8,
    resolvedThresholds["outlierFraction"] ?? 0.05,
    resolvedWeights,
  );
  components.push(
    metricsToComponent(
      "denseEmbedding",
      "Dense Embedding",
      denseEmbeddingMetrics,
      COMPONENT_WEIGHTS.denseEmbedding,
    ),
  );

  if (
    failFast &&
    components.some((c) => c.metrics.some((m) => m.mustPassPassed === false))
  ) {
    return buildReport(t0, components, sampleSize, topK, configFile, undefined);
  }

  // ─── Component 5: Sparse Input (optional) ─────────────────────────────────
  const sparseChunks = sample.filter((c) => !!c.sparseText);
  const sparseInputMetrics = computeSparseInputMetrics(
    { chunks: sparseChunks.map((c) => ({ sparseText: c.sparseText })) },
    resolvedWeights,
  );
  const sparseSkipped = sparseChunks.length === 0;
  components.push(
    metricsToComponent(
      "sparseInput",
      "Sparse Input Prep",
      sparseInputMetrics,
      COMPONENT_WEIGHTS.sparseInput,
      sparseSkipped,
      sparseSkipped ? "No sparseText in sampled chunks" : undefined,
    ),
  );

  // ─── Component 6: Lexical Retrieval (optional) ────────────────────────────
  const lexicalMetrics = await computeLexicalRetrievalMetrics(
    {
      chunks: sample.map((c) => ({
        id: c.denseTextHash,
        denseText: c.denseText,
      })),
      ftsSearchFn,
      topK,
    },
    resolvedWeights,
  );
  components.push(
    metricsToComponent(
      "lexicalRetrieval",
      "Lexical Retrieval",
      lexicalMetrics,
      COMPONENT_WEIGHTS.lexicalRetrieval,
    ),
  );

  // ─── Component 7: Reranker Input (optional) ───────────────────────────────
  const rerankerInputMetrics = computeRerankerInputMetrics(
    { samples: [], rerankerAvailable },
    resolvedWeights,
  );
  components.push(
    metricsToComponent(
      "rerankerInput",
      "Reranker Input",
      rerankerInputMetrics,
      COMPONENT_WEIGHTS.rerankerInput,
      !rerankerAvailable,
      !rerankerAvailable ? "No reranker configured" : undefined,
    ),
  );

  // ─── Component 8: Reranker (optional) ────────────────────────────────────
  const rerankerMetrics = computeRerankerMetrics(
    {
      rerankerMrr: null,
      baselineMrr: null,
      rerankerScores: [],
      rerankerAvailable,
    },
    resolvedWeights,
  );
  components.push(
    metricsToComponent(
      "reranker",
      "Reranker",
      rerankerMetrics,
      COMPONENT_WEIGHTS.reranker,
      !rerankerAvailable,
      !rerankerAvailable ? "No reranker configured" : undefined,
    ),
  );

  // ─── RAGBench evaluation (optional) ─────────────────────────────────────
  let ragBench: RagBenchSummary | undefined;
  if (ragBenchPath) {
    const dataset = await loadRagBenchDataset(ragBenchPath);
    const evaluator = new RagBenchEvaluator(cfg.vectorStore, cfg.embedder);
    const result = await evaluator.evaluate(dataset, topK);
    ragBench = result;
  }

  return buildReport(t0, components, sampleSize, topK, configFile, ragBench);
}

function buildReport(
  t0: number,
  components: ComponentResult[],
  sampleSize: number,
  topK: number,
  configFile: string,
  ragBench: RagBenchSummary | undefined,
): QualityReport {
  const mustPassGates = collectMustPassGates(components);
  const overallScore = aggregateOverall(components);
  const status = computeStatus(overallScore, mustPassGates);

  return {
    timestamp: new Date().toISOString(),
    overallScore,
    status,
    mustPassGates,
    components,
    ...(ragBench ? { ragBench } : {}),
    sampleSize,
    topK,
    configFile,
    durationMs: Date.now() - t0,
  };
}

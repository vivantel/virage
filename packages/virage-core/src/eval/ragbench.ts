/**
 * RAGBench integration — loads standard retrieval benchmark datasets (TREC qrels format
 * or RAGBench JSON) and evaluates the Virage index against them.
 *
 * Supported formats:
 *   JSON:  { queries: [{id, query, qrels: [{docId, relevance}]}] }
 *   TREC:  Lines of "queryId  0  docId  relevance"
 *
 * Computes: MRR@K, NDCG@K, Recall@K, Precision@K, HitRate@K
 */

import { readFile } from "fs/promises";
import {
  precisionAtK,
  recallAtK,
  reciprocalRank,
  hitRateAtK,
} from "./metrics.js";
import type { VectorStore } from "../interfaces/vector-store.js";
import type { EmbeddingProvider } from "../interfaces/embedder.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface QrelEntry {
  docId: string;
  relevance: number;
}

export interface RagBenchQuery {
  id: string;
  query: string;
  qrels: QrelEntry[];
}

export interface RagBenchDataset {
  queries: RagBenchQuery[];
  source?: string;
}

export interface RagBenchResult {
  datasetSource: string;
  queriesEvaluated: number;
  topK: number;
  mrrAtK: number;
  ndcgAtK: number;
  recallAtK: number;
  precisionAtK: number;
  hitRateAtK: number;
}

// ─── Loaders ───────────────────────────────────────────────────────────────────

/** Parse RAGBench JSON format. */
function parseJsonDataset(raw: string, source: string): RagBenchDataset {
  const parsed = JSON.parse(raw) as {
    queries: Array<{
      id?: string;
      query: string;
      qrels: Array<{ docId: string; relevance: number }>;
    }>;
  };
  return {
    source,
    queries: parsed.queries.map((q, i) => ({
      id: q.id ?? String(i),
      query: q.query,
      qrels: q.qrels,
    })),
  };
}

/**
 * Parse TREC qrels format.
 * Expects a separate queries file (TSV: id\tquery) and a qrels file.
 * If only one path is given, tries JSON first, then TREC qrels-only.
 */
function parseTrecQrels(
  qrelsRaw: string,
  queriesRaw: string,
  source: string,
): RagBenchDataset {
  const queryMap = new Map<string, string>();
  for (const line of queriesRaw.split("\n")) {
    const [id, ...parts] = line.trim().split(/\t/);
    if (id && parts.length > 0) queryMap.set(id, parts.join("\t"));
  }

  const qrelMap = new Map<string, QrelEntry[]>();
  for (const line of qrelsRaw.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [queryId, , docId, relStr] = parts;
    const relevance = parseInt(relStr, 10);
    if (!qrelMap.has(queryId)) qrelMap.set(queryId, []);
    qrelMap.get(queryId)!.push({ docId, relevance });
  }

  const queries: RagBenchQuery[] = [];
  for (const [id, query] of queryMap) {
    const qrels = qrelMap.get(id) ?? [];
    if (qrels.some((q) => q.relevance > 0)) {
      queries.push({ id, query, qrels });
    }
  }

  return { source, queries };
}

/**
 * Load a RAGBench dataset from a local path.
 * Supports JSON format (recommended) or TREC format (two-file: path,queriesPath).
 */
export async function loadRagBenchDataset(
  path: string,
  queriesPath?: string,
): Promise<RagBenchDataset> {
  const raw = await readFile(path, "utf-8");

  if (path.endsWith(".json") || path.endsWith(".jsonl")) {
    return parseJsonDataset(raw, path);
  }

  if (queriesPath) {
    const queriesRaw = await readFile(queriesPath, "utf-8");
    return parseTrecQrels(raw, queriesRaw, path);
  }

  // Try JSON first, fall back to TREC-only (qrels without separate query file)
  try {
    return parseJsonDataset(raw, path);
  } catch {
    throw new Error(
      `Cannot parse RAGBench dataset at "${path}". ` +
        `Use JSON format or provide --queries-path for TREC format.`,
    );
  }
}

// ─── NDCG ─────────────────────────────────────────────────────────────────────

function ndcgAtK(results: string[], qrels: QrelEntry[], k: number): number {
  const relevanceMap = new Map(qrels.map((q) => [q.docId, q.relevance]));

  // DCG
  let dcg = 0;
  for (let i = 0; i < Math.min(results.length, k); i++) {
    const rel = relevanceMap.get(results[i]) ?? 0;
    dcg += rel / Math.log2(i + 2);
  }

  // IDCG: ideal ordering
  const sorted = [...qrels]
    .filter((q) => q.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, k);
  let idcg = 0;
  for (let i = 0; i < sorted.length; i++) {
    idcg += sorted[i].relevance / Math.log2(i + 2);
  }

  return idcg === 0 ? 0 : dcg / idcg;
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

export class RagBenchEvaluator {
  constructor(
    private readonly vectorStore: VectorStore,
    private readonly embedder: EmbeddingProvider,
  ) {}

  async evaluate(
    dataset: RagBenchDataset,
    topK: number,
  ): Promise<RagBenchResult> {
    await this.vectorStore.initialize();

    const mrrScores: number[] = [];
    const ndcgScores: number[] = [];
    const recallScores: number[] = [];
    const precisionScores: number[] = [];
    const hitRateScores: number[] = [];

    for (const q of dataset.queries) {
      const embed = await this.embedder.embed(q.query);
      const results = await this.vectorStore.search(embed, topK);
      const resultIds = results.map((r) => r.id);

      const relevantSet = new Set(
        q.qrels.filter((qr) => qr.relevance > 0).map((qr) => qr.docId),
      );

      if (relevantSet.size === 0) continue;

      mrrScores.push(reciprocalRank(resultIds, relevantSet));
      ndcgScores.push(ndcgAtK(resultIds, q.qrels, topK));
      recallScores.push(recallAtK(resultIds, relevantSet, topK));
      precisionScores.push(precisionAtK(resultIds, relevantSet, topK));
      hitRateScores.push(hitRateAtK(resultIds, relevantSet, topK));
    }

    const avg = (arr: number[]) =>
      arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;

    return {
      datasetSource: dataset.source ?? "unknown",
      queriesEvaluated: mrrScores.length,
      topK,
      mrrAtK: avg(mrrScores),
      ndcgAtK: avg(ndcgScores),
      recallAtK: avg(recallScores),
      precisionAtK: avg(precisionScores),
      hitRateAtK: avg(hitRateScores),
    };
  }
}

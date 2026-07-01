/**
 * RAGBench HuggingFace integration.
 *
 * For each of the 12 galileo-ai/ragbench subsets:
 *   1. Download queries via HuggingFace Datasets Server
 *   2. Pool all unique documents across every query into a per-subset corpus
 *   3. Embed the corpus with the configured embedder and store in-memory
 *   4. For each query: embed the question, search top-K, measure retrieval
 *      quality against the all_relevant_sentence_keys ground truth
 *
 * The in-memory store uses exact cosine similarity — appropriate for the
 * small corpus sizes here (≤ ~400 unique docs per subset).
 */

import type { EmbeddingProvider } from "../interfaces/embedder.js";
import { computeContentHash } from "../core/utils.js";
import { reciprocalRank, recallAtK, hitRateAtK } from "./metrics.js";

// ─── Subset list ──────────────────────────────────────────────────────────────

export const HF_RAGBENCH_SUBSETS = [
  "covidqa",
  "cuad",
  "delucionqa",
  "emanual",
  "expertqa",
  "finqa",
  "hagrid",
  "hotpotqa",
  "msmarco",
  "pubmedqa",
  "tatqa",
  "techqa",
] as const;

export type HfRagBenchSubset = (typeof HF_RAGBENCH_SUBSETS)[number];

// ─── Result types ─────────────────────────────────────────────────────────────

export interface HfSubsetResult {
  subset: string;
  corpusSize: number;
  queriesEvaluated: number;
  topK: number;
  mrrAtK: number;
  ndcgAtK: number;
  recallAtK: number;
  hitRateAtK: number;
}

export interface HfRagBenchSummary {
  subsets: HfSubsetResult[];
  totalQueries: number;
  totalCorpusDocs: number;
  topK: number;
  macroMrrAtK: number;
  macroNdcgAtK: number;
  macroRecallAtK: number;
  macroHitRateAtK: number;
}

// ─── HuggingFace row type ─────────────────────────────────────────────────────

interface HfRow {
  id: string;
  question: string;
  documents: string[];
  all_relevant_sentence_keys: string[];
}

// ─── Download ─────────────────────────────────────────────────────────────────

const HF_ROWS_URL = "https://datasets-server.huggingface.co/rows";
const HF_DATASET = "galileo-ai/ragbench";

async function fetchPage(
  subset: string,
  offset: number,
  length: number,
  token?: string,
): Promise<{ rows: HfRow[]; total: number }> {
  const url = new URL(HF_ROWS_URL);
  url.searchParams.set("dataset", HF_DATASET);
  url.searchParams.set("config", subset);
  url.searchParams.set("split", "test");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", String(length));

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(
      `HuggingFace Datasets Server error ${res.status} for subset "${subset}": ${await res.text()}`,
    );
  }

  const data = (await res.json()) as {
    rows: Array<{ row: HfRow }>;
    num_rows_total: number;
  };

  return {
    rows: data.rows.map((r) => r.row),
    total: data.num_rows_total,
  };
}

async function downloadSubset(
  subset: string,
  maxRows: number,
  token?: string,
): Promise<HfRow[]> {
  const pageSize = Math.min(100, maxRows);
  const first = await fetchPage(subset, 0, pageSize, token);
  const rows = [...first.rows];

  while (rows.length < Math.min(maxRows, first.total)) {
    const remaining = Math.min(maxRows, first.total) - rows.length;
    const page = await fetchPage(
      subset,
      rows.length,
      Math.min(100, remaining),
      token,
    );
    if (page.rows.length === 0) break;
    rows.push(...page.rows);
  }

  return rows;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

interface StoreEntry {
  id: string;
  vec: number[];
}

class InMemRagBenchStore {
  private readonly entries: StoreEntry[] = [];
  private readonly seen = new Set<string>();

  upsert(docs: StoreEntry[]): void {
    for (const d of docs) {
      if (this.seen.has(d.id)) continue;
      this.seen.add(d.id);
      this.entries.push(d);
    }
  }

  search(queryVec: number[], k: number): Array<{ id: string }> {
    return this.entries
      .map((e) => ({ id: e.id, sim: cosineSim(queryVec, e.vec) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, k)
      .map((e) => ({ id: e.id }));
  }
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Relevance helpers ────────────────────────────────────────────────────────

function relevantDocIds(row: HfRow): Set<string> {
  const docIndices = new Set<number>();
  for (const key of row.all_relevant_sentence_keys) {
    const m = key.match(/^(\d+)/);
    if (m) docIndices.add(parseInt(m[1], 10));
  }
  const ids = new Set<string>();
  for (const i of docIndices) {
    if (i < row.documents.length) {
      ids.add(computeContentHash(row.documents[i]));
    }
  }
  return ids;
}

// ─── NDCG (local copy — not yet exported from metrics.ts) ─────────────────────

interface QrelEntry {
  docId: string;
  relevance: number;
}

function ndcgAtK(results: string[], qrels: QrelEntry[], k: number): number {
  const relMap = new Map(qrels.map((q) => [q.docId, q.relevance]));
  let dcg = 0;
  for (let i = 0; i < Math.min(results.length, k); i++) {
    dcg += (relMap.get(results[i]) ?? 0) / Math.log2(i + 2);
  }
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

// ─── Per-subset evaluator ─────────────────────────────────────────────────────

async function evalSubset(
  embedder: EmbeddingProvider,
  rows: HfRow[],
  subset: string,
  topK: number,
): Promise<HfSubsetResult> {
  // Build deduped corpus
  const corpus = new Map<string, string>(); // id → text
  for (const row of rows) {
    for (const doc of row.documents) {
      const id = computeContentHash(doc);
      if (!corpus.has(id)) corpus.set(id, doc);
    }
  }

  const corpusIds = [...corpus.keys()];
  const corpusTexts = corpusIds.map((id) => corpus.get(id)!);

  // Embed corpus
  const corpusVecs = embedder.embedBatch
    ? await embedder.embedBatch(corpusTexts)
    : await Promise.all(corpusTexts.map((t) => embedder.embed(t)));

  const store = new InMemRagBenchStore();
  store.upsert(corpusIds.map((id, i) => ({ id, vec: corpusVecs[i] })));

  const mrrScores: number[] = [];
  const ndcgScores: number[] = [];
  const recallScores: number[] = [];
  const hitRateScores: number[] = [];

  for (const row of rows) {
    const relevant = relevantDocIds(row);
    if (relevant.size === 0) continue;

    const queryVec = await embedder.embed(row.question);
    const results = store.search(queryVec, topK).map((r) => r.id);

    // Binary qrels for NDCG (relevance = 1 for each relevant doc)
    const qrels: QrelEntry[] = [...relevant].map((docId) => ({
      docId,
      relevance: 1,
    }));

    mrrScores.push(reciprocalRank(results, relevant));
    ndcgScores.push(ndcgAtK(results, qrels, topK));
    recallScores.push(recallAtK(results, relevant, topK));
    hitRateScores.push(hitRateAtK(results, relevant, topK));
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;

  return {
    subset,
    corpusSize: corpus.size,
    queriesEvaluated: mrrScores.length,
    topK,
    mrrAtK: avg(mrrScores),
    ndcgAtK: avg(ndcgScores),
    recallAtK: avg(recallScores),
    hitRateAtK: avg(hitRateScores),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface HfRagBenchEvalOptions {
  subsets?: string[];
  maxRowsPerSubset?: number;
  topK?: number;
  hfToken?: string;
}

export async function runHfRagBenchEval(
  embedder: EmbeddingProvider,
  opts: HfRagBenchEvalOptions = {},
): Promise<HfRagBenchSummary> {
  const subsets = opts.subsets ?? [...HF_RAGBENCH_SUBSETS];
  const maxRows = opts.maxRowsPerSubset ?? 50;
  const topK = opts.topK ?? 10;

  const results: HfSubsetResult[] = [];

  for (const subset of subsets) {
    const rows = await downloadSubset(subset, maxRows, opts.hfToken);
    const result = await evalSubset(embedder, rows, subset, topK);
    results.push(result);
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;

  return {
    subsets: results,
    totalQueries: results.reduce((s, r) => s + r.queriesEvaluated, 0),
    totalCorpusDocs: results.reduce((s, r) => s + r.corpusSize, 0),
    topK,
    macroMrrAtK: avg(results.map((r) => r.mrrAtK)),
    macroNdcgAtK: avg(results.map((r) => r.ndcgAtK)),
    macroRecallAtK: avg(results.map((r) => r.recallAtK)),
    macroHitRateAtK: avg(results.map((r) => r.hitRateAtK)),
  };
}

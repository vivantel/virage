export interface StatusData {
  totalChunks: number;
  totalEmbeddings: number;
  memoryMB: number;
}

export interface HistogramBucket {
  label: string;
  count: number;
}

export interface ChunksData {
  histogram: HistogramBucket[];
}

export interface Anomaly {
  sourceFile: string;
  zscore: number;
  preview: string;
}

export interface AnomaliesData {
  anomalies: Anomaly[];
}

export interface ProjectEntry {
  label: string;
  rootPath: string;
  embeddingsDb: string;
  lastUsed: number;
}

export interface ProjectsData {
  projects: ProjectEntry[];
  activeIndex: number;
}

export interface ChunkRecord {
  id: string;
  sourceFile: string;
  denseText: string;
  sparseText: string;
  sparseTextGeneratorId: string;
  metadataGeneratorId: string;
  metadata: Record<string, unknown>;
  /** Legacy field from SQLite fallback. */
  content?: string;
  /** Legacy field from SQLite fallback. */
  contentHash?: string;
}

export interface ChunksAllResponse {
  chunks: ChunkRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SearchResult {
  id: string;
  /** Dense embedding text (breadcrumb + body). */
  denseText: string;
  /** BM25/FTS body text (no breadcrumb prefix). */
  sparseText: string;
  /** Context assembled from sibling chunks (prevSiblingId / nextSiblingId in metadata). */
  contextText?: string;
  metadata: Record<string, unknown>;
  similarity: number;
  sourceFile?: string;
  sparseTextGeneratorId?: string;
  metadataGeneratorId?: string;
  /** Legacy alias kept for backward compatibility with older API responses. */
  content?: string;
}

export interface StatTestResult {
  baselineMrr: number;
  candidateMrr: number;
  mrrDelta: number;
  pValue: number;
  confidenceInterval95: [number, number];
  recommendation: "accept" | "reject" | "inconclusive";
}

export interface EvalResult {
  mrr: number;
  precisionAt5: number;
  recallAt10: number;
  hitRateAt5: number;
  queriesEvaluated: number;
}

export interface ExperimentRun {
  id: string;
  name: string;
  timestamp: string;
  evalResult: EvalResult;
  perQueryRrScores?: number[];
  ragasResult?: Record<string, unknown>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
    };
    throw new Error(err.error ?? `${path}: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "DELETE",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
    };
    throw new Error(err.error ?? `${path}: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface SearchQueryRecord {
  id: string;
  occurred_at: string;
  query_text: string;
  query_hash: string;
  result_count: number;
  top_similarity: number | null;
  was_empty: number;
  hybrid_used: number;
  reranked: number;
}

export interface SearchStats {
  queriesLastHour: number;
  queriesLast24h: number;
  avgTopSimilarity: number;
  zeroResultRate: number;
}

export interface TopTerm {
  query_text: string;
  count: number;
}

export interface QueriesPerHour {
  hour: string;
  count: number;
}

export const api = {
  // Existing
  status: () => get<StatusData>("/api/status"),
  chunks: () => get<ChunksData>("/api/chunks"),
  anomalies: () => get<AnomaliesData>("/api/embeddings/anomalies"),
  projects: () => get<ProjectsData>("/api/projects"),
  addProject: (rootPath: string) =>
    post<ProjectsData>("/api/projects/add", { rootPath }),
  switchProject: (index: number) =>
    post<ProjectsData>("/api/projects/switch", { index }),

  // Chunks
  chunksAll: (opts?: {
    page?: number;
    pageSize?: number;
    sourceFile?: string;
  }) => {
    const params = new URLSearchParams();
    if (opts?.page !== undefined) params.set("page", String(opts.page));
    if (opts?.pageSize !== undefined)
      params.set("pageSize", String(opts.pageSize));
    if (opts?.sourceFile) params.set("sourceFile", opts.sourceFile);
    const qs = params.toString();
    return get<ChunksAllResponse>(`/api/chunks/all${qs ? `?${qs}` : ""}`);
  },
  chunkFiles: () => get<{ files: string[] }>("/api/chunks/files"),
  deleteChunksFile: (sourceFile: string) =>
    del<{ ok: boolean }>("/api/chunks/file", { sourceFile }),
  deleteChunksAll: () => del<{ ok: boolean }>("/api/chunks/all"),

  // Meta check
  metaCheck: () =>
    get<{ status: "ok" | "mismatch" | "unknown"; message?: string }>(
      "/api/meta-check",
    ),

  // Search
  search: (query: string, topK?: number) =>
    post<{ results: SearchResult[] }>("/api/search", { query, topK }),

  // Experiments
  experiments: () => get<{ runs: ExperimentRun[] }>("/api/experiments"),
  experiment: (id: string) => get<ExperimentRun>(`/api/experiments/${id}`),
  deleteExperiment: (id: string) =>
    del<{ ok: boolean }>(`/api/experiments/${id}`),
  compareExperiments: (baseline: string, candidate: string) =>
    post<StatTestResult>("/api/experiments/compare", { baseline, candidate }),

  // Analytics
  analytics: {
    queries: (limit?: number) =>
      get<{ queries: SearchQueryRecord[] }>(
        `/api/analytics/queries${limit ? `?limit=${limit}` : ""}`,
      ),
    topTerms: (limit?: number) =>
      get<{ terms: TopTerm[] }>(
        `/api/analytics/top-terms${limit ? `?limit=${limit}` : ""}`,
      ),
    zeroResults: (threshold?: number) =>
      get<{ queries: SearchQueryRecord[] }>(
        `/api/analytics/zero-results${threshold != null ? `?threshold=${threshold}` : ""}`,
      ),
    stats: () => get<SearchStats>("/api/analytics/stats"),
    perHour: (hours?: number) =>
      get<{ buckets: QueriesPerHour[] }>(
        `/api/analytics/queries-per-hour${hours ? `?hours=${hours}` : ""}`,
      ),
  },
};

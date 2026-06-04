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
  chunksFile: string;
  embeddingsDb: string;
  lastUsed: number;
}

export interface ProjectsData {
  projects: ProjectEntry[];
  activeIndex: number;
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

export const api = {
  status: () => get<StatusData>("/api/status"),
  chunks: () => get<ChunksData>("/api/chunks"),
  anomalies: () => get<AnomaliesData>("/api/embeddings/anomalies"),
  projects: () => get<ProjectsData>("/api/projects"),
  addProject: (rootPath: string) =>
    post<ProjectsData>("/api/projects/add", { rootPath }),
  switchProject: (index: number) =>
    post<ProjectsData>("/api/projects/switch", { index }),
};

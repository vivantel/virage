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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  status: () => get<StatusData>("/api/status"),
  chunks: () => get<ChunksData>("/api/chunks"),
  anomalies: () => get<AnomaliesData>("/api/embeddings/anomalies"),
};

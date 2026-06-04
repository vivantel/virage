import { useEffect, useState } from "react";
import { api } from "./api/client.js";
import type { StatusData, ChunksData, AnomaliesData } from "./api/client.js";
import { StatusCard } from "./components/StatusCard.js";
import { ChunkHistogram } from "./components/ChunkHistogram.js";
import { AnomalyTable } from "./components/AnomalyTable.js";

const POLL_INTERVAL_MS = 5000;

interface DashboardState {
  status: StatusData | null;
  chunks: ChunksData | null;
  anomalies: AnomaliesData | null;
  error: string | null;
}

export function App() {
  const [state, setState] = useState<DashboardState>({
    status: null,
    chunks: null,
    anomalies: null,
    error: null,
  });

  async function refresh() {
    try {
      const [status, chunks, anomalies] = await Promise.all([
        api.status(),
        api.chunks(),
        api.anomalies(),
      ]);
      setState({ status, chunks, anomalies, error: null });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="container">
      <h1>🤖 RAG Dashboard</h1>
      {state.error && <div className="card error">⚠️ {state.error}</div>}
      {state.status && <StatusCard data={state.status} />}
      {state.chunks && <ChunkHistogram buckets={state.chunks.histogram} />}
      {state.anomalies && <AnomalyTable anomalies={state.anomalies.anomalies} />}
      {!state.status && !state.error && <div className="card">Loading...</div>}
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "./api/client.js";
import type {
  StatusData,
  ChunksData,
  AnomaliesData,
  ProjectsData,
} from "./api/client.js";
import { StatusCard } from "./components/StatusCard.js";
import { ChunkHistogram } from "./components/ChunkHistogram.js";
import { AnomalyTable } from "./components/AnomalyTable.js";
import { ProjectSwitcher } from "./components/ProjectSwitcher.js";

const POLL_INTERVAL_MS = 5000;

interface DashboardState {
  status: StatusData | null;
  chunks: ChunksData | null;
  anomalies: AnomaliesData | null;
  projects: ProjectsData | null;
  error: string | null;
  addProjectError: string | null;
}

export function App() {
  const [state, setState] = useState<DashboardState>({
    status: null,
    chunks: null,
    anomalies: null,
    projects: null,
    error: null,
    addProjectError: null,
  });

  async function refresh() {
    try {
      const [status, chunks, anomalies, projects] = await Promise.all([
        api.status(),
        api.chunks(),
        api.anomalies(),
        api.projects(),
      ]);
      setState((prev) => ({
        ...prev,
        status,
        chunks,
        anomalies,
        projects,
        error: null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  async function handleSwitch(index: number) {
    try {
      const updated = await api.switchProject(index);
      setState((prev) => ({
        ...prev,
        projects: updated,
        addProjectError: null,
      }));
      void refresh();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  async function handleAdd(rootPath: string) {
    try {
      const updated = await api.addProject(rootPath);
      setState((prev) => ({
        ...prev,
        projects: updated,
        addProjectError: null,
      }));
      void refresh();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        addProjectError: err instanceof Error ? err.message : String(err),
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
      {state.projects && (
        <ProjectSwitcher
          projects={state.projects.projects}
          activeIndex={state.projects.activeIndex}
          onSwitch={handleSwitch}
          onAdd={handleAdd}
          addError={state.addProjectError}
        />
      )}
      <h1>RAG Dashboard</h1>
      {state.error && <div className="card error">⚠️ {state.error}</div>}
      {state.status && <StatusCard data={state.status} />}
      {state.chunks && <ChunkHistogram buckets={state.chunks.histogram} />}
      {state.anomalies && (
        <AnomalyTable anomalies={state.anomalies.anomalies} />
      )}
      {!state.status && !state.error && <div className="card">Loading...</div>}
    </div>
  );
}

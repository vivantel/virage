import { useEffect, useState } from "react";
import { api } from "../api/client";
import type {
  StatusData,
  ChunksData,
  AnomaliesData,
  ProjectsData,
} from "../api/client";
import { StatusCard } from "./StatusCard";
import { ChunkHistogram } from "./ChunkHistogram";
import { AnomalyTable } from "./AnomalyTable";
import { ProjectSwitcher } from "./ProjectSwitcher";

const POLL_INTERVAL_MS = 5000;

interface HomeState {
  status: StatusData | null;
  chunks: ChunksData | null;
  anomalies: AnomaliesData | null;
  projects: ProjectsData | null;
  metaMismatch: string | null;
  error: string | null;
  addProjectError: string | null;
}

export function HomePage() {
  const [state, setState] = useState<HomeState>({
    status: null,
    chunks: null,
    anomalies: null,
    projects: null,
    metaMismatch: null,
    error: null,
    addProjectError: null,
  });

  async function refresh() {
    try {
      const [status, chunks, anomalies, projects, metaResult] =
        await Promise.all([
          api.status(),
          api.chunks(),
          api.anomalies(),
          api.projects(),
          api.metaCheck(),
        ]);
      setState((prev) => ({
        ...prev,
        status,
        chunks,
        anomalies,
        projects,
        metaMismatch:
          metaResult.status === "mismatch"
            ? (metaResult.message ?? null)
            : null,
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
    <>
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
      {state.metaMismatch && (
        <div className="card warning">⚠️ {state.metaMismatch}</div>
      )}
      {state.error && <div className="card error">⚠️ {state.error}</div>}
      {state.status && <StatusCard data={state.status} />}
      {state.chunks && <ChunkHistogram buckets={state.chunks.histogram} />}
      {state.anomalies && (
        <AnomalyTable anomalies={state.anomalies.anomalies} />
      )}
      {!state.status && !state.error && <div className="card">Loading...</div>}
    </>
  );
}

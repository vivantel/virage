import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
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
}

export function HomePage() {
  const [state, setState] = useState<HomeState>({
    status: null,
    chunks: null,
    anomalies: null,
    projects: null,
    metaMismatch: null,
  });
  const { showError } = useToast();

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
      }));
    } catch (err) {
      showError("Failed to load dashboard data", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSwitch(index: number) {
    try {
      const updated = await api.switchProject(index);
      setState((prev) => ({ ...prev, projects: updated }));
      void refresh();
    } catch (err) {
      showError("Failed to switch project", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAdd(rootPath: string) {
    try {
      const updated = await api.addProject(rootPath);
      setState((prev) => ({ ...prev, projects: updated }));
      void refresh();
    } catch (err) {
      showError("Failed to add project", err instanceof Error ? err.message : String(err));
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
        />
      )}
      <h1>RAG Dashboard</h1>
      {state.metaMismatch && (
        <div className="card warning">⚠️ {state.metaMismatch}</div>
      )}
      {state.status && <StatusCard data={state.status} />}
      {state.chunks && <ChunkHistogram buckets={state.chunks.histogram} />}
      {state.anomalies && (
        <AnomalyTable anomalies={state.anomalies.anomalies} />
      )}
      {!state.status && <div className="card">Loading...</div>}
    </>
  );
}

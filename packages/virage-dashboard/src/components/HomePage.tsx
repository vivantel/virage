import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useWs } from "../context/WebSocketContext";
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
  const { dashboardSnapshot } = useWs();

  // Single initial fetch for everything (before WS connects)
  useEffect(() => {
    async function init() {
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
        showError(
          "Failed to load dashboard data",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    void init();
  }, [showError]);

  // When WS pushes a dashboard-update, replace status/histogram/anomalies in-place
  useEffect(() => {
    if (!dashboardSnapshot) return;
    setState((prev) => ({
      ...prev,
      status: dashboardSnapshot.status,
      chunks: { histogram: dashboardSnapshot.histogram },
      anomalies: { anomalies: dashboardSnapshot.anomalies },
    }));
  }, [dashboardSnapshot]);

  async function handleSwitch(index: number) {
    try {
      const updated = await api.switchProject(index);
      setState((prev) => ({ ...prev, projects: updated }));
    } catch (err) {
      showError(
        "Failed to switch project",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleAdd(rootPath: string) {
    try {
      const updated = await api.addProject(rootPath);
      setState((prev) => ({ ...prev, projects: updated }));
    } catch (err) {
      showError(
        "Failed to add project",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

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

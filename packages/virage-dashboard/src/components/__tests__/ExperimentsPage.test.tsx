import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PrimeReactProvider } from "primereact/api";
import { ExperimentsPage } from "../ExperimentsPage";

vi.mock("../../api/client", () => ({
  api: {
    experiments: vi.fn(),
    deleteExperiment: vi.fn(),
    compareExperiments: vi.fn(),
  },
}));

vi.mock("../../context/WebSocketContext", () => ({
  WebSocketProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useWs: () => ({
    status: "disconnected",
    operationRunning: false,
    messages: [],
    startOp: vi.fn(),
  }),
}));

import { api } from "../../api/client";

const sampleRuns = [
  {
    id: "exp-1",
    name: "baseline",
    timestamp: "2026-06-01T10:00:00Z",
    evalResult: {
      mrr: 0.65,
      precisionAt5: 0.72,
      recallAt10: 0.81,
      hitRateAt5: 0.88,
      queriesEvaluated: 100,
    },
  },
  {
    id: "exp-2",
    name: "candidate-A",
    timestamp: "2026-06-02T11:00:00Z",
    evalResult: {
      mrr: 0.71,
      precisionAt5: 0.77,
      recallAt10: 0.84,
      hitRateAt5: 0.9,
      queriesEvaluated: 100,
    },
  },
];

function renderPage() {
  return render(
    <PrimeReactProvider>
      <ExperimentsPage />
    </PrimeReactProvider>,
  );
}

describe("ExperimentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Experiments heading", () => {
    vi.mocked(api.experiments).mockResolvedValue({ runs: [] });
    renderPage();
    expect(screen.getByText("Experiments")).toBeTruthy();
  });

  it("shows empty state when no experiments", async () => {
    vi.mocked(api.experiments).mockResolvedValue({ runs: [] });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/No experiments found/i)).toBeTruthy(),
    );
  });

  it("lists experiment names and metrics", async () => {
    vi.mocked(api.experiments).mockResolvedValue({ runs: sampleRuns });
    renderPage();
    await waitFor(() => expect(screen.getByText("baseline")).toBeTruthy());
    expect(screen.getByText("candidate-A")).toBeTruthy();
    expect(screen.getByText("65.0%")).toBeTruthy();
    expect(screen.getByText("71.0%")).toBeTruthy();
  });

  it("shows New Experiment card with Run button", async () => {
    vi.mocked(api.experiments).mockResolvedValue({ runs: [] });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("New Experiment")).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: /run/i })).toBeTruthy();
  });

  it("shows compare button only after 2 rows are selected", async () => {
    vi.mocked(api.experiments).mockResolvedValue({ runs: sampleRuns });
    renderPage();
    await waitFor(() => expect(screen.getByText("baseline")).toBeTruthy());
    expect(
      screen.queryByRole("button", { name: /compare selected/i }),
    ).toBeNull();
  });

  it("shows error card when loading fails", async () => {
    vi.mocked(api.experiments).mockRejectedValue(new Error("Load error"));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Load error/)).toBeTruthy());
  });

  it("calls api.experiments on mount", async () => {
    vi.mocked(api.experiments).mockResolvedValue({ runs: [] });
    renderPage();
    await waitFor(() => expect(api.experiments).toHaveBeenCalledOnce());
  });
});

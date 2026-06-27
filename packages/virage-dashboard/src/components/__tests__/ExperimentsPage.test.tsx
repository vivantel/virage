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

let mockWsMessages: Array<{ type: string; [key: string]: unknown }> = [];
let mockWsCurrentOp: string | null = null;
let mockWsOperationRunning = false;
const mockStartOp = vi.fn();

vi.mock("../../context/WebSocketContext", () => ({
  WebSocketProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useWs: () => ({
    status: "connected",
    operationRunning: mockWsOperationRunning,
    messages: mockWsMessages,
    currentOp: mockWsCurrentOp,
    startOp: mockStartOp,
  }),
}));

const mockShowError = vi.fn();
vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showError: mockShowError, showSuccess: vi.fn() }),
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
    mockWsMessages = [];
    mockWsCurrentOp = null;
    mockWsOperationRunning = false;
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

  it("shows error toast when loading fails", async () => {
    vi.mocked(api.experiments).mockRejectedValue(new Error("Load error"));
    renderPage();
    await waitFor(() =>
      expect(mockShowError).toHaveBeenCalledWith(
        "Failed to load experiments",
        "Load error",
      ),
    );
  });

  it("calls api.experiments on mount", async () => {
    vi.mocked(api.experiments).mockResolvedValue({ runs: [] });
    renderPage();
    await waitFor(() => expect(api.experiments).toHaveBeenCalledOnce());
  });

  it("renders Run Log when eval-save op is active", () => {
    vi.mocked(api.experiments).mockResolvedValue({ runs: [] });
    mockWsCurrentOp = "eval-save";
    mockWsMessages = [{ type: "progress", stage: "eval", done: 3, total: 10 }];
    mockWsOperationRunning = true;
    renderPage();
    expect(screen.getByText("Run Log")).toBeTruthy();
    expect(screen.getByText(/\[eval\] 3 \/ 10/)).toBeTruthy();
  });

  it("does not render Run Log when index op is active (pipeline-only op)", () => {
    vi.mocked(api.experiments).mockResolvedValue({ runs: [] });
    mockWsCurrentOp = "index";
    mockWsMessages = [{ type: "progress", stage: "chunk", done: 1, total: 5 }];
    mockWsOperationRunning = true;
    renderPage();
    expect(screen.queryByText("Run Log")).toBeNull();
  });

  it("does not render Run Log when idle (no messages)", () => {
    vi.mocked(api.experiments).mockResolvedValue({ runs: [] });
    mockWsCurrentOp = null;
    mockWsMessages = [];
    renderPage();
    expect(screen.queryByText("Run Log")).toBeNull();
  });
});

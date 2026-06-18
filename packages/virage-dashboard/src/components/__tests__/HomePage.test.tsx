import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PrimeReactProvider } from "primereact/api";
import { HomePage } from "../HomePage";

vi.mock("../../api/client", () => ({
  api: {
    status: vi.fn(),
    chunks: vi.fn(),
    anomalies: vi.fn(),
    projects: vi.fn(),
    metaCheck: vi.fn(),
    switchProject: vi.fn(),
    addProject: vi.fn(),
  },
}));

vi.mock("../../context/WebSocketContext", () => ({
  WebSocketProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWs: () => ({ status: "disconnected", operationRunning: false, messages: [], startOp: vi.fn() }),
}));

import { api } from "../../api/client";

const mockStatus = { totalChunks: 42, totalEmbeddings: 38, memoryMB: 128 };
const mockChunks = { histogram: [{ label: "0-100", count: 10 }] };
const mockAnomalies = { anomalies: [] };
const mockProjects = {
  projects: [{ label: "my-project", rootPath: "/home/user/proj", embeddingsDb: "db", lastUsed: Date.now() }],
  activeIndex: 0,
};
const mockMeta = { status: "ok" as const };

function setup() {
  vi.mocked(api.status).mockResolvedValue(mockStatus);
  vi.mocked(api.chunks).mockResolvedValue(mockChunks);
  vi.mocked(api.anomalies).mockResolvedValue(mockAnomalies);
  vi.mocked(api.projects).mockResolvedValue(mockProjects);
  vi.mocked(api.metaCheck).mockResolvedValue(mockMeta);
}

function renderPage() {
  return render(
    <PrimeReactProvider>
      <HomePage />
    </PrimeReactProvider>,
  );
}

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading card before data arrives", () => {
    vi.mocked(api.status).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.chunks).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.anomalies).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.projects).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.metaCheck).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading/i)).toBeTruthy();
  });

  it("displays system metrics after load", async () => {
    setup();
    renderPage();
    await waitFor(() => expect(screen.getByText("42")).toBeTruthy());
    expect(screen.getByText("38")).toBeTruthy();
    expect(screen.getByText("128 MB")).toBeTruthy();
  });

  it("renders project switcher with active project name", async () => {
    setup();
    renderPage();
    await waitFor(() => expect(screen.getByText("my-project")).toBeTruthy());
  });

  it("renders the RAG Dashboard heading", async () => {
    setup();
    renderPage();
    await waitFor(() => expect(screen.getByText("RAG Dashboard")).toBeTruthy());
  });

  it("shows error card when API throws", async () => {
    vi.mocked(api.status).mockRejectedValue(new Error("Network error"));
    vi.mocked(api.chunks).mockRejectedValue(new Error("Network error"));
    vi.mocked(api.anomalies).mockRejectedValue(new Error("Network error"));
    vi.mocked(api.projects).mockRejectedValue(new Error("Network error"));
    vi.mocked(api.metaCheck).mockRejectedValue(new Error("Network error"));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Network error/)).toBeTruthy());
  });

  it("shows meta mismatch warning when API returns mismatch", async () => {
    vi.mocked(api.status).mockResolvedValue(mockStatus);
    vi.mocked(api.chunks).mockResolvedValue(mockChunks);
    vi.mocked(api.anomalies).mockResolvedValue(mockAnomalies);
    vi.mocked(api.projects).mockResolvedValue(mockProjects);
    vi.mocked(api.metaCheck).mockResolvedValue({
      status: "mismatch",
      message: "Schema mismatch detected",
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Schema mismatch/)).toBeTruthy());
  });

  it("shows anomaly table when anomalies are present", async () => {
    vi.mocked(api.status).mockResolvedValue(mockStatus);
    vi.mocked(api.chunks).mockResolvedValue(mockChunks);
    vi.mocked(api.anomalies).mockResolvedValue({
      anomalies: [{ sourceFile: "src/bad.ts", zscore: 3.5, preview: "weird content" }],
    });
    vi.mocked(api.projects).mockResolvedValue(mockProjects);
    vi.mocked(api.metaCheck).mockResolvedValue(mockMeta);
    renderPage();
    await waitFor(() => expect(screen.getByText("src/bad.ts")).toBeTruthy());
    expect(screen.getByText("3.50")).toBeTruthy();
  });
});

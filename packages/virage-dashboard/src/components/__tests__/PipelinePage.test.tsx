import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrimeReactProvider } from "primereact/api";
import { PipelinePage } from "../PipelinePage";

const mockStartOp = vi.fn();
let mockMessages: Array<{ type: string; [key: string]: unknown }> = [];
let mockStatus = "connected";
let mockOperationRunning = false;

vi.mock("../../context/WebSocketContext", () => ({
  useWs: () => ({
    status: mockStatus,
    operationRunning: mockOperationRunning,
    messages: mockMessages,
    startOp: mockStartOp,
  }),
}));

function renderPage() {
  return render(
    <PrimeReactProvider>
      <PipelinePage />
    </PrimeReactProvider>,
  );
}

describe("PipelinePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMessages = [];
    mockStatus = "connected";
    mockOperationRunning = false;
  });

  it("renders Pipeline heading", () => {
    renderPage();
    expect(screen.getByText("Pipeline")).toBeTruthy();
  });

  it("renders Run button when idle", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /run/i })).toBeTruthy();
  });

  it("Run button is disabled when operation is running", () => {
    mockOperationRunning = true;
    renderPage();
    expect(screen.getByRole("button", { name: /running/i })).toBeDisabled();
  });

  it("calls startOp with correct op when Run is clicked", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /run/i }));
    expect(mockStartOp).toHaveBeenCalledWith({ op: "index" });
  });

  it("shows placeholder text when no messages", () => {
    renderPage();
    expect(screen.getByText(/Select an operation/i)).toBeTruthy();
  });

  it("renders progress messages in the log", () => {
    mockMessages = [{ type: "progress", stage: "embed", done: 50, total: 100 }];
    renderPage();
    expect(screen.getByText(/\[embed\] 50 \/ 100/)).toBeTruthy();
  });

  it("renders done message in the log", () => {
    mockMessages = [{ type: "done", message: "Index updated" }];
    renderPage();
    expect(screen.getByText(/✓ Completed — Index updated/)).toBeTruthy();
  });

  it("renders error message in the log", () => {
    mockMessages = [{ type: "error", message: "Out of memory" }];
    renderPage();
    expect(screen.getByText(/✗ Error: Out of memory/)).toBeTruthy();
  });

  it("shows error status tag when WS is in error state", () => {
    mockStatus = "error";
    renderPage();
    expect(screen.getByText("Error")).toBeTruthy();
  });

  it("shows connecting status tag", () => {
    mockStatus = "connecting";
    renderPage();
    expect(screen.getByText("Connecting…")).toBeTruthy();
  });
});

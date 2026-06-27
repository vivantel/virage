import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrimeReactProvider } from "primereact/api";
import { PipelineLog } from "../PipelineLog";

let mockCurrentOp: string | null = null;
let mockMessages: Array<{ type: string; [key: string]: unknown }> = [];

vi.mock("../../context/WebSocketContext", () => ({
  useWs: () => ({
    status: "connected",
    operationRunning: mockMessages.length > 0,
    messages: mockMessages,
    currentOp: mockCurrentOp,
    startOp: vi.fn(),
  }),
}));

function render$(allowedOps: string[], title?: string) {
  return render(
    <PrimeReactProvider>
      <PipelineLog allowedOps={allowedOps} title={title} />
    </PrimeReactProvider>,
  );
}

describe("PipelineLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentOp = null;
    mockMessages = [];
  });

  it("renders nothing when messages is empty", () => {
    mockCurrentOp = "index";
    mockMessages = [];
    const { container } = render$(["index"]);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when currentOp is not in allowedOps", () => {
    mockCurrentOp = "index";
    mockMessages = [{ type: "progress", stage: "chunk", done: 1, total: 5 }];
    const { container } = render$(["eval-run", "eval-save"]);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when currentOp is null", () => {
    mockCurrentOp = null;
    mockMessages = [{ type: "progress", stage: "chunk", done: 1, total: 5 }];
    const { container } = render$(["index"]);
    expect(container.firstChild).toBeNull();
  });

  it("renders log when currentOp matches allowedOps and messages exist", () => {
    mockCurrentOp = "index";
    mockMessages = [{ type: "progress", stage: "chunk", done: 5, total: 20 }];
    render$(["index"]);
    const pre = document.querySelector("pre.pipeline-log");
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toContain("[chunk] 5 / 20");
  });

  it("renders when allowedOps is empty (always-show mode) and messages exist", () => {
    mockCurrentOp = null;
    mockMessages = [{ type: "done" }];
    render$([]);
    expect(document.querySelector("pre.pipeline-log")).toBeTruthy();
  });

  it("formats done message correctly", () => {
    mockCurrentOp = "eval-save";
    mockMessages = [{ type: "done", message: "Saved!" }];
    render$(["eval-save"]);
    expect(document.querySelector("pre.pipeline-log")?.textContent).toContain(
      "✓ Completed — Saved!",
    );
  });

  it("formats error message correctly", () => {
    mockCurrentOp = "index";
    mockMessages = [{ type: "error", message: "Index failed" }];
    render$(["index"]);
    expect(document.querySelector("pre.pipeline-log")?.textContent).toContain(
      "✗ Error: Index failed",
    );
  });

  it("renders title when provided", () => {
    mockCurrentOp = "eval-save";
    mockMessages = [{ type: "done" }];
    render$(["eval-save"], "Run Log");
    expect(screen.getByText("Run Log")).toBeTruthy();
  });

  it("does not render title when log is hidden", () => {
    mockCurrentOp = "index";
    mockMessages = [{ type: "progress", stage: "chunk", done: 1, total: 1 }];
    render$(["eval-run"], "Run Log");
    expect(screen.queryByText("Run Log")).toBeNull();
  });
});

import { useEffect, useRef, useState } from "react";
import { useWebSocket, type WsMessage } from "../hooks/useWebSocket";

type PipelineOp = "update" | "eval-generate" | "evaluate";

function formatMessage(msg: WsMessage): string {
  if (msg.type === "progress") {
    if (msg["message"])
      return `[${String(msg["stage"] ?? "info")}] ${String(msg["message"])}`;
    return `[${String(msg["stage"] ?? "progress")}] ${String(msg["done"] ?? 0)} / ${String(msg["total"] ?? "?")}`;
  }
  if (msg.type === "done") {
    const extra = msg["message"] ? ` — ${String(msg["message"])}` : "";
    return `✓ Completed${extra}`;
  }
  if (msg.type === "error")
    return `✗ Error: ${String(msg["message"] ?? "unknown")}`;
  if (msg.type === "busy")
    return "⚠ Server busy — another operation is running";
  if (msg.type === "raw") return String(msg["text"] ?? "");
  return JSON.stringify(msg);
}

export function PipelinePage() {
  const [op, setOp] = useState<PipelineOp>("update");
  const { connect, send, messages, status } = useWebSocket("/ws");
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-disconnect when operation finishes
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (
      last &&
      (last.type === "done" || last.type === "error" || last.type === "busy")
    ) {
      // leave connected so user can see final state; disconnect on next run
    }
  }, [messages]);

  function handleRun() {
    connect();
    // send after a tick so the ws.onopen fires first
    setTimeout(() => send({ op }), 50);
  }

  const isRunning = status === "connecting" || status === "connected";
  const statusLabel: Record<typeof status, string> = {
    disconnected: "Idle",
    connecting: "Connecting…",
    connected: "Running",
    error: "Error",
  };

  return (
    <div>
      <h2>Pipeline</h2>
      <div className="pipeline-controls">
        <select
          value={op}
          onChange={(e) => setOp(e.target.value as PipelineOp)}
          disabled={isRunning}
        >
          <option value="update">Update index (virage update)</option>
          <option value="eval-generate">Generate eval dataset</option>
          <option value="evaluate">Run evaluation</option>
        </select>
        <button onClick={handleRun} disabled={isRunning}>
          {isRunning ? "Running…" : "Run"}
        </button>
        <span className={`status-badge status-${status}`}>
          {statusLabel[status]}
        </span>
      </div>

      <pre ref={logRef} className="pipeline-log">
        {messages.length === 0
          ? "— Select an operation and click Run —"
          : messages.map(formatMessage).join("\n")}
      </pre>
    </div>
  );
}

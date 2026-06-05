import { useEffect, useRef, useState } from "react";
import { useWs, type WsMessage } from "../context/WebSocketContext";

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
  const { startOp, messages, status, operationRunning } = useWs();
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  const statusLabel: Record<typeof status, string> = {
    disconnected: "Idle",
    connecting: "Connecting…",
    connected: operationRunning ? "Running" : "Idle",
    error: "Error",
  };

  return (
    <div>
      <h2>Pipeline</h2>
      <div className="pipeline-controls">
        <select
          value={op}
          onChange={(e) => setOp(e.target.value as PipelineOp)}
          disabled={operationRunning}
        >
          <option value="update">Update index (virage update)</option>
          <option value="eval-generate">Generate eval dataset</option>
          <option value="evaluate">Run evaluation</option>
        </select>
        <button onClick={() => startOp({ op })} disabled={operationRunning}>
          {operationRunning ? "Running…" : "Run"}
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

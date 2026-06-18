import { useEffect, useRef } from "react";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { Tag } from "primereact/tag";
import {
  useWs,
  type WsMessage,
  type WsStatus,
} from "../context/WebSocketContext";
import { useState } from "react";

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

const opOptions = [
  { label: "Update index (virage update)", value: "update" },
  { label: "Generate eval dataset", value: "eval-generate" },
  { label: "Run evaluation", value: "evaluate" },
];

const statusSeverity: Record<
  WsStatus,
  "success" | "info" | "warning" | "danger"
> = {
  disconnected: "warning",
  connecting: "info",
  connected: "success",
  error: "danger",
};

const statusLabel: Record<WsStatus, string> = {
  disconnected: "Idle",
  connecting: "Connecting…",
  connected: "Idle",
  error: "Error",
};

export function PipelinePage() {
  const [op, setOp] = useState<PipelineOp>("update");
  const { startOp, messages, status, operationRunning } = useWs();
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  const label =
    status === "connected" && operationRunning
      ? "Running"
      : statusLabel[status];

  return (
    <div>
      <h2>Pipeline</h2>
      <div className="pipeline-controls">
        <Dropdown
          value={op}
          options={opOptions}
          onChange={(e) => setOp(e.value as PipelineOp)}
          disabled={operationRunning}
          style={{ minWidth: "260px" }}
        />
        <Button
          label={operationRunning ? "Running…" : "Run"}
          icon={operationRunning ? "pi pi-spin pi-spinner" : "pi pi-play"}
          onClick={() => startOp({ op })}
          disabled={operationRunning}
        />
        <Tag severity={statusSeverity[status]} value={label} />
      </div>

      <pre ref={logRef} className="pipeline-log">
        {messages.length === 0
          ? "— Select an operation and click Run —"
          : messages.map(formatMessage).join("\n")}
      </pre>
    </div>
  );
}

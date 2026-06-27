import { useState } from "react";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { Tag } from "primereact/tag";
import { useWs, type WsStatus } from "../context/WebSocketContext";
import { PipelineLog } from "./PipelineLog";

type PipelineOp = "index" | "eval-generate" | "eval-run";

const opOptions = [
  { label: "Index (virage index)", value: "index" },
  {
    label: "Generate eval dataset (virage eval generate)",
    value: "eval-generate",
  },
  { label: "Run evaluation (virage eval run)", value: "eval-run" },
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
  const [op, setOp] = useState<PipelineOp>("index");
  const { startOp, status, operationRunning } = useWs();

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

      <PipelineLog
        allowedOps={["index", "eval-generate", "eval-run"]}
        placeholder="— Select an operation and click Run —"
        alwaysShow
      />
    </div>
  );
}

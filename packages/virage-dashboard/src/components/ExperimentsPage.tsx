import { useEffect, useRef, useState } from "react";
import {
  DataTable,
  type DataTableExpandedRows,
  type DataTableSelectionMultipleChangeEvent,
} from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Card } from "primereact/card";
import { Tag } from "primereact/tag";
import { ProgressSpinner } from "primereact/progressspinner";
import { api, type ExperimentRun, type StatTestResult } from "../api/client";
import { useWs, type WsMessage } from "../context/WebSocketContext";
import { useToast } from "../context/ToastContext";

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

const fmt = (n: number) => (n * 100).toFixed(1) + "%";

const recommendationSeverity: Record<string, "success" | "danger" | "warning"> =
  {
    accept: "success",
    reject: "danger",
    inconclusive: "warning",
  };

export function ExperimentsPage() {
  const [runs, setRuns] = useState<ExperimentRun[]>([]);
  const [expandedRows, setExpandedRows] = useState<DataTableExpandedRows>({});
  const [selectedRuns, setSelectedRuns] = useState<ExperimentRun[]>([]);
  const [compareResult, setCompareResult] = useState<StatTestResult | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const { startOp, messages, operationRunning } = useWs();
  const { showError } = useToast();
  const logRef = useRef<HTMLPreElement>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.experiments();
      setRuns(data.runs);
    } catch (err) {
      showError(
        "Failed to load experiments",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.type === "done") void load();
  }, [messages]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleDelete(id: string) {
    try {
      await api.deleteExperiment(id);
      setSelectedRuns((s) => s.filter((r) => r.id !== id));
      await load();
    } catch (err) {
      showError(
        "Failed to delete experiment",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleCompare() {
    if (selectedRuns.length !== 2) return;
    try {
      const result = await api.compareExperiments(
        selectedRuns[0].id,
        selectedRuns[1].id,
      );
      setCompareResult(result);
    } catch (err) {
      showError(
        "Comparison failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  function handleSelectionChange(
    e: DataTableSelectionMultipleChangeEvent<ExperimentRun[]>,
  ) {
    const sel = e.value;
    if (sel.length <= 2) {
      setSelectedRuns(sel);
      setCompareResult(null);
    }
  }

  const rowExpansionTemplate = (run: ExperimentRun) => (
    <div className="experiment-detail card p-3">
      <p>
        <strong>ID:</strong> {run.id}
      </p>
      <p>
        <strong>Queries evaluated:</strong> {run.evalResult.queriesEvaluated}
      </p>
      {run.ragasResult && <pre>{JSON.stringify(run.ragasResult, null, 2)}</pre>}
    </div>
  );

  const actionBodyTemplate = (run: ExperimentRun) => (
    <div className="row-actions">
      <Button
        icon="pi pi-trash"
        severity="danger"
        size="small"
        text
        onClick={() => void handleDelete(run.id)}
      />
    </div>
  );

  return (
    <div>
      <h2>Experiments</h2>

      <Card title="New Experiment" className="mb-4">
        <div className="pipeline-controls">
          <InputText
            placeholder="Experiment name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={operationRunning}
            className="flex-1"
          />
          <Button
            label={operationRunning ? "Running…" : "Run"}
            icon={operationRunning ? "pi pi-spin pi-spinner" : "pi pi-play"}
            onClick={() => startOp({ op: "eval-save", name: newName })}
            disabled={operationRunning || !newName.trim()}
          />
        </div>
        {messages.length > 0 && (
          <pre ref={logRef} className="pipeline-log mt-2">
            {messages.map(formatMessage).join("\n")}
          </pre>
        )}
      </Card>

      {selectedRuns.length === 2 && (
        <div className="toolbar mb-3">
          <Button
            label={`Compare selected (${selectedRuns.length}/2)`}
            icon="pi pi-chart-bar"
            onClick={() => void handleCompare()}
          />
          <Button
            label="Clear selection"
            outlined
            onClick={() => {
              setSelectedRuns([]);
              setCompareResult(null);
            }}
          />
        </div>
      )}

      {compareResult && (
        <Card className="mb-4">
          <h3 className="mt-0">Comparison Result</h3>
          <DataTable
            value={[
              { metric: "Baseline MRR", value: fmt(compareResult.baselineMrr) },
              {
                metric: "Candidate MRR",
                value: fmt(compareResult.candidateMrr),
              },
              {
                metric: "Delta",
                value:
                  (compareResult.mrrDelta > 0 ? "+" : "") +
                  fmt(compareResult.mrrDelta),
              },
              { metric: "p-value", value: compareResult.pValue.toFixed(4) },
              {
                metric: "95% CI",
                value: `[${fmt(compareResult.confidenceInterval95[0])}, ${fmt(compareResult.confidenceInterval95[1])}]`,
              },
            ]}
            size="small"
          >
            <Column field="metric" header="Metric" />
            <Column field="value" header="Value" />
          </DataTable>
          <div className="mt-3">
            <Tag
              severity={recommendationSeverity[compareResult.recommendation]}
              value={`Verdict: ${compareResult.recommendation.toUpperCase()}`}
            />
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center p-8">
          <ProgressSpinner />
        </div>
      ) : runs.length === 0 ? (
        <Card>
          No experiments found. Enter a name above and click Run to create one.
        </Card>
      ) : (
        <DataTable
          value={runs}
          dataKey="id"
          selection={selectedRuns}
          onSelectionChange={handleSelectionChange}
          selectionMode="checkbox"
          expandedRows={expandedRows}
          onRowToggle={(e) => setExpandedRows(e.data as DataTableExpandedRows)}
          rowExpansionTemplate={rowExpansionTemplate}
          size="small"
          stripedRows
          className="experiment-table"
        >
          <Column selectionMode="multiple" headerStyle={{ width: "3rem" }} />
          <Column expander style={{ width: "3rem" }} />
          <Column field="name" header="Name" />
          <Column
            header="Date"
            body={(r: ExperimentRun) => new Date(r.timestamp).toLocaleString()}
          />
          <Column
            header="MRR"
            body={(r: ExperimentRun) => fmt(r.evalResult.mrr)}
          />
          <Column
            header="P@5"
            body={(r: ExperimentRun) => fmt(r.evalResult.precisionAt5)}
          />
          <Column
            header="R@10"
            body={(r: ExperimentRun) => fmt(r.evalResult.recallAt10)}
          />
          <Column
            header="Hit@5"
            body={(r: ExperimentRun) => fmt(r.evalResult.hitRateAt5)}
          />
          <Column body={actionBodyTemplate} style={{ width: "60px" }} />
        </DataTable>
      )}
    </div>
  );
}

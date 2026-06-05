import { useEffect, useRef, useState } from "react";
import { api, type ExperimentRun, type StatTestResult } from "../api/client";
import { useWs, type WsMessage } from "../context/WebSocketContext";

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

export function ExperimentsPage() {
  const [runs, setRuns] = useState<ExperimentRun[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [compareResult, setCompareResult] = useState<StatTestResult | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const { startOp, messages, operationRunning } = useWs();
  const logRef = useRef<HTMLPreElement>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.experiments();
      setRuns(data.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Refresh list when an experiment-run operation completes
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.type === "done") {
      void load();
    }
  }, [messages]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleDelete(id: string) {
    try {
      await api.deleteExperiment(id);
      setSelected((s) => s.filter((x) => x !== id));
      if (expanded === id) setExpanded(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleSelect(id: string) {
    setSelected((s) =>
      s.includes(id)
        ? s.filter((x) => x !== id)
        : s.length < 2
          ? [...s, id]
          : s,
    );
    setCompareResult(null);
  }

  async function handleCompare() {
    if (selected.length !== 2) return;
    try {
      const result = await api.compareExperiments(selected[0], selected[1]);
      setCompareResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const fmt = (n: number) => (n * 100).toFixed(1) + "%";

  return (
    <div>
      <h2>Experiments</h2>
      {error && <div className="card error">⚠️ {error}</div>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>New Experiment</h3>
        <div className="pipeline-controls">
          <input
            type="text"
            placeholder="Experiment name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={operationRunning}
            style={{ flex: 1 }}
          />
          <button
            onClick={() => startOp({ op: "experiment-run", name: newName })}
            disabled={operationRunning || !newName.trim()}
          >
            {operationRunning ? "Running…" : "Run"}
          </button>
        </div>
        {messages.length > 0 && (
          <pre ref={logRef} className="pipeline-log" style={{ marginTop: 8 }}>
            {messages.map(formatMessage).join("\n")}
          </pre>
        )}
      </div>

      {selected.length === 2 && (
        <div className="toolbar">
          <button onClick={() => void handleCompare()}>
            Compare selected ({selected.length}/2)
          </button>
          <button
            onClick={() => {
              setSelected([]);
              setCompareResult(null);
            }}
          >
            Clear selection
          </button>
        </div>
      )}

      {compareResult && (
        <div
          className={`card compare-result badge-${compareResult.recommendation}`}
        >
          <strong>Comparison result</strong>
          <table>
            <tbody>
              <tr>
                <td>Baseline MRR</td>
                <td>{fmt(compareResult.baselineMrr)}</td>
              </tr>
              <tr>
                <td>Candidate MRR</td>
                <td>{fmt(compareResult.candidateMrr)}</td>
              </tr>
              <tr>
                <td>Delta</td>
                <td>
                  {compareResult.mrrDelta > 0 ? "+" : ""}
                  {fmt(compareResult.mrrDelta)}
                </td>
              </tr>
              <tr>
                <td>p-value</td>
                <td>{compareResult.pValue.toFixed(4)}</td>
              </tr>
              <tr>
                <td>95% CI</td>
                <td>
                  [{fmt(compareResult.confidenceInterval95[0])},{" "}
                  {fmt(compareResult.confidenceInterval95[1])}]
                </td>
              </tr>
              <tr>
                <td>Verdict</td>
                <td>
                  <span
                    className={`badge badge-${compareResult.recommendation}`}
                  >
                    {compareResult.recommendation.toUpperCase()}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {loading ? (
        <div className="card">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="card">
          No experiments found. Enter a name above and click Run to create one.
        </div>
      ) : (
        <table className="experiment-table">
          <thead>
            <tr>
              <th>Select</th>
              <th>Name</th>
              <th>Date</th>
              <th>MRR</th>
              <th>P@5</th>
              <th>R@10</th>
              <th>Hit@5</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <>
                <tr
                  key={r.id}
                  className={expanded === r.id ? "expanded-row" : ""}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      disabled={
                        !selected.includes(r.id) && selected.length >= 2
                      }
                    />
                  </td>
                  <td>{r.name}</td>
                  <td>{new Date(r.timestamp).toLocaleString()}</td>
                  <td>{fmt(r.evalResult.mrr)}</td>
                  <td>{fmt(r.evalResult.precisionAt5)}</td>
                  <td>{fmt(r.evalResult.recallAt10)}</td>
                  <td>{fmt(r.evalResult.hitRateAt5)}</td>
                  <td className="row-actions">
                    <button
                      className="btn-sm"
                      onClick={() =>
                        setExpanded(expanded === r.id ? null : r.id)
                      }
                    >
                      {expanded === r.id ? "▲" : "▼"}
                    </button>
                    <button
                      className="btn-sm btn-danger"
                      onClick={() => void handleDelete(r.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
                {expanded === r.id && (
                  <tr key={`${r.id}-detail`}>
                    <td colSpan={8}>
                      <div className="experiment-detail card">
                        <p>
                          <strong>ID:</strong> {r.id}
                        </p>
                        <p>
                          <strong>Queries evaluated:</strong>{" "}
                          {r.evalResult.queriesEvaluated}
                        </p>
                        {r.ragasResult && (
                          <pre>{JSON.stringify(r.ragasResult, null, 2)}</pre>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

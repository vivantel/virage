import { useEffect, useState } from "react";
import { api, type ExperimentRun, type StatTestResult } from "../api/client";

export function ExperimentsPage() {
  const [runs, setRuns] = useState<ExperimentRun[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [compareResult, setCompareResult] = useState<StatTestResult | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          No experiments found. Run{" "}
          <code>virage experiment run --name &lt;name&gt;</code> first.
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

import type { Anomaly } from "../api/client.js";

interface Props {
  anomalies: Anomaly[];
}

export function AnomalyTable({ anomalies }: Props) {
  if (anomalies.length === 0) {
    return <div className="card">✅ No embedding anomalies detected</div>;
  }

  return (
    <div className="card">
      <h2>⚠️ Embedding Anomalies ({anomalies.length})</h2>
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>z-score</th>
            <th>Preview</th>
          </tr>
        </thead>
        <tbody>
          {anomalies.slice(0, 10).map((a, i) => (
            <tr key={i} className="anomaly">
              <td>{a.sourceFile}</td>
              <td>{a.zscore.toFixed(2)}</td>
              <td>{a.preview}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

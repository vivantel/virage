import type { HistogramBucket } from "../api/client.js";

interface Props {
  buckets: HistogramBucket[];
}

export function ChunkHistogram({ buckets }: Props) {
  if (buckets.length === 0) return null;

  const maxCount = Math.max(...buckets.map((b) => b.count));

  return (
    <div className="card">
      <h2>Chunk Size Distribution</h2>
      {buckets.map((b) => {
        const pct = maxCount > 0 ? Math.round((b.count / maxCount) * 100) : 0;
        return (
          <div key={b.label}>
            <div style={{ fontSize: 12 }}>{b.label}</div>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div style={{ fontSize: 11, color: "#888" }}>{b.count} chunks</div>
          </div>
        );
      })}
    </div>
  );
}

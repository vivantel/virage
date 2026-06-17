import { useEffect, useState } from "react";
import {
  api,
  type SearchQueryRecord,
  type SearchStats,
  type TopTerm,
  type QueriesPerHour,
} from "../api/client";

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toFixed(3);
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

export function AnalyticsPage() {
  const [stats, setStats] = useState<SearchStats | null>(null);
  const [perHour, setPerHour] = useState<QueriesPerHour[]>([]);
  const [terms, setTerms] = useState<TopTerm[]>([]);
  const [zeroResults, setZeroResults] = useState<SearchQueryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [statsData, perHourData, termsData, zeroData] = await Promise.all([
        api.analytics.stats(),
        api.analytics.perHour(24),
        api.analytics.topTerms(20),
        api.analytics.zeroResults(0.5),
      ]);
      setStats(statsData);
      setPerHour(perHourData.buckets);
      setTerms(termsData.terms);
      setZeroResults(zeroData.queries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <p>Loading analytics…</p>;
  if (error) return <p className="error">Error: {error}</p>;

  const maxCount = Math.max(...perHour.map((b) => b.count), 1);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Search Activity</h2>
        <button onClick={() => void load()} style={{ marginLeft: "auto" }}>
          Refresh
        </button>
      </div>

      {stats && (
        <div className="stat-grid" style={{ marginBottom: 24 }}>
          <StatCard label="Queries (last hour)" value={stats.queriesLastHour} />
          <StatCard label="Queries (24 h)" value={stats.queriesLast24h} />
          <StatCard
            label="Avg top similarity"
            value={stats.queriesLast24h > 0 ? fmt(stats.avgTopSimilarity) : "—"}
          />
          <StatCard
            label="Zero-result rate"
            value={stats.queriesLast24h > 0 ? pct(stats.zeroResultRate) : "—"}
          />
        </div>
      )}

      <section style={{ marginBottom: 28 }}>
        <h3>Queries per Hour (last 24 h)</h3>
        {perHour.length === 0 ? (
          <p className="muted">No data yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Hour</th>
                <th>Queries</th>
                <th style={{ width: "50%" }}></th>
              </tr>
            </thead>
            <tbody>
              {perHour.map((b) => (
                <tr key={b.hour}>
                  <td style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {b.hour.slice(11, 16)} UTC
                  </td>
                  <td>{b.count}</td>
                  <td>
                    <div
                      style={{
                        background: "var(--accent, #6366f1)",
                        height: 10,
                        borderRadius: 3,
                        width: `${(b.count / maxCount) * 100}%`,
                        minWidth: b.count > 0 ? 4 : 0,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginBottom: 28 }}>
        <h3>Top 20 Search Terms</h3>
        {terms.length === 0 ? (
          <p className="muted">No searches recorded yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Query</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {terms.map((t, i) => (
                <tr key={t.query_text}>
                  <td>{i + 1}</td>
                  <td>{t.query_text}</td>
                  <td>{t.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3>Low-Quality Queries (top similarity &lt; 0.5)</h3>
        {zeroResults.length === 0 ? (
          <p className="muted">No low-quality queries detected.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Query</th>
                <th>Results</th>
                <th>Top similarity</th>
                <th>When</th>
                <th>Hybrid</th>
              </tr>
            </thead>
            <tbody>
              {zeroResults.map((q) => (
                <tr key={q.id}>
                  <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {q.query_text}
                  </td>
                  <td>{q.result_count}</td>
                  <td>{fmt(q.top_similarity)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{relTime(q.occurred_at)}</td>
                  <td>{q.hybrid_used ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

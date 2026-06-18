import { useEffect, useState } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Chart } from "primereact/chart";
import { ProgressSpinner } from "primereact/progressspinner";
import {
  api,
  type SearchQueryRecord,
  type SearchStats,
  type TopTerm,
  type QueriesPerHour,
} from "../api/client";
import { useToast } from "../context/ToastContext";

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
  const { showError } = useToast();

  async function load() {
    setLoading(true);
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
      showError(
        "Failed to load analytics",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <ProgressSpinner />
      </div>
    );
  }

  const perHourChartData = {
    labels: perHour.map((b) => b.hour.slice(11, 16) + " UTC"),
    datasets: [
      {
        label: "Queries",
        data: perHour.map((b) => b.count),
        backgroundColor: "#7ec8e3",
        borderRadius: 4,
      },
    ],
  };

  const chartOptions = {
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: "#aaa" }, grid: { color: "#1e3a5f" } },
      y: { ticks: { color: "#aaa" }, grid: { color: "#1e3a5f" } },
    },
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <h2 style={{ margin: 0 }}>Search Activity</h2>
        <Button
          label="Refresh"
          icon="pi pi-refresh"
          size="small"
          outlined
          onClick={() => void load()}
          style={{ marginLeft: "auto" }}
        />
      </div>

      {stats && (
        <div className="stat-grid mb-6">
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

      <Card title="Queries per Hour (last 24 h)" className="mb-4">
        {perHour.length === 0 ? (
          <p className="muted">No data yet.</p>
        ) : (
          <Chart type="bar" data={perHourChartData} options={chartOptions} />
        )}
      </Card>

      <Card title="Top 20 Search Terms" className="mb-4">
        {terms.length === 0 ? (
          <p className="muted">No searches recorded yet.</p>
        ) : (
          <DataTable value={terms} size="small" stripedRows>
            <Column
              header="#"
              body={(_: TopTerm, opt) => opt.rowIndex + 1}
              style={{ width: "50px" }}
            />
            <Column field="query_text" header="Query" />
            <Column field="count" header="Count" style={{ width: "80px" }} />
          </DataTable>
        )}
      </Card>

      <Card title="Low-Quality Queries (top similarity < 0.5)">
        {zeroResults.length === 0 ? (
          <p className="muted">No low-quality queries detected.</p>
        ) : (
          <DataTable value={zeroResults} size="small" stripedRows>
            <Column
              field="query_text"
              header="Query"
              style={{
                maxWidth: "320px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            />
            <Column
              field="result_count"
              header="Results"
              style={{ width: "80px" }}
            />
            <Column
              header="Top similarity"
              body={(q: SearchQueryRecord) => fmt(q.top_similarity)}
              style={{ width: "120px" }}
            />
            <Column
              header="When"
              body={(q: SearchQueryRecord) => relTime(q.occurred_at)}
              style={{ width: "100px", whiteSpace: "nowrap" }}
            />
            <Column
              header="Hybrid"
              body={(q: SearchQueryRecord) => (q.hybrid_used ? "yes" : "no")}
              style={{ width: "70px" }}
            />
          </DataTable>
        )}
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

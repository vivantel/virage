import { Card } from "primereact/card";
import { Chart } from "primereact/chart";
import type { HistogramBucket } from "../api/client.js";

interface Props {
  buckets: HistogramBucket[];
}

export function ChunkHistogram({ buckets }: Props) {
  if (buckets.length === 0) return null;

  const chartData = {
    labels: buckets.map((b) => b.label),
    datasets: [
      {
        label: "Chunks",
        data: buckets.map((b) => b.count),
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
    <Card title="Chunk Size Distribution" className="mb-4">
      <Chart type="bar" data={chartData} options={chartOptions} />
    </Card>
  );
}

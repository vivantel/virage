import { useEffect, useRef } from "react";
import { Card } from "primereact/card";
import type { Chart as ChartType, ChartConfiguration } from "chart.js";
import type { HistogramBucket } from "../api/client.js";

interface Props {
  buckets: HistogramBucket[];
}

const CHART_OPTIONS: ChartConfiguration["options"] = {
  animation: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: "#aaa" }, grid: { color: "#1e3a5f" } },
    y: {
      ticks: { color: "#aaa", precision: 0 },
      grid: { color: "#1e3a5f" },
      beginAtZero: true,
    },
  },
  responsive: true,
  maintainAspectRatio: true,
};

export function ChunkHistogram({ buckets }: Props) {
  const allEmpty = buckets.length === 0 || buckets.every((b) => b.count === 0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartType | null>(null);

  // Create the chart once when switching from empty → non-empty; destroy on unmount or back to empty
  useEffect(() => {
    if (allEmpty || !canvasRef.current) return;

    let mounted = true;
    async function create() {
      const { Chart, registerables } = await import("chart.js");
      Chart.register(...registerables);
      if (!mounted || !canvasRef.current) return;
      chartRef.current = new Chart(canvasRef.current, {
        type: "bar",
        data: {
          labels: buckets.map((b) => b.label),
          datasets: [
            {
              label: "Chunks",
              data: buckets.map((b) => b.count),
              backgroundColor: "#7ec8e3",
              borderRadius: 4,
            },
          ],
        },
        options: CHART_OPTIONS,
      });
    }

    void create();
    return () => {
      mounted = false;
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEmpty]);

  // Update data in-place on every buckets change — no animation, no flicker
  useEffect(() => {
    if (!chartRef.current || allEmpty) return;
    chartRef.current.data.labels = buckets.map((b) => b.label);
    chartRef.current.data.datasets[0].data = buckets.map((b) => b.count);
    chartRef.current.update("none");
  }, [buckets, allEmpty]);

  if (allEmpty) {
    return (
      <Card title="Chunk Size Distribution" className="mb-4">
        <p className="text-color-secondary m-0">
          No chunks indexed yet. Run <code>virage index</code> to populate.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Chunk Size Distribution" className="mb-4">
      <canvas ref={canvasRef} />
    </Card>
  );
}

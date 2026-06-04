import type { StatusData } from "../api/client.js";

interface Props {
  data: StatusData;
}

export function StatusCard({ data }: Props) {
  return (
    <div className="card">
      <h2>System Status</h2>
      <div className="metrics">
        <Metric value={data.totalChunks} label="Total Chunks" />
        <Metric value={data.totalEmbeddings} label="Embeddings" />
        <Metric value={`${data.memoryMB} MB`} label="Heap Used" />
      </div>
    </div>
  );
}

function Metric({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="metric">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

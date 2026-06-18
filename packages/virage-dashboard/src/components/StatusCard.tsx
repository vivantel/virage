import { Card } from "primereact/card";
import { Tag } from "primereact/tag";
import type { StatusData } from "../api/client.js";

interface Props {
  data: StatusData;
}

export function StatusCard({ data }: Props) {
  return (
    <Card title="System Status" className="mb-4">
      <div className="flex flex-wrap gap-6">
        <Metric value={data.totalChunks} label="Total Chunks" />
        <Metric value={data.totalEmbeddings} label="Embeddings" />
        <Metric value={`${data.memoryMB} MB`} label="Heap Used" />
      </div>
      <div className="mt-3">
        <Tag severity="success" value="Online" icon="pi pi-circle-fill" />
      </div>
    </Card>
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

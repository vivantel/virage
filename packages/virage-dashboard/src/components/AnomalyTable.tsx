import { Card } from "primereact/card";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import type { Anomaly } from "../api/client.js";

interface Props {
  anomalies: Anomaly[];
}

export function AnomalyTable({ anomalies }: Props) {
  if (anomalies.length === 0) {
    return (
      <Card className="mb-4">
        <div className="flex items-center gap-2">
          <Tag
            severity="success"
            value="No embedding anomalies detected"
            icon="pi pi-check"
          />
        </div>
      </Card>
    );
  }

  return (
    <Card title={`Embedding Anomalies (${anomalies.length})`} className="mb-4">
      <DataTable value={anomalies.slice(0, 10)} size="small" stripedRows>
        <Column
          field="sourceFile"
          header="File"
          style={{
            maxWidth: "200px",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        />
        <Column
          field="zscore"
          header="Z-score"
          body={(a: Anomaly) => a.zscore.toFixed(2)}
          style={{ width: "100px" }}
        />
        <Column field="preview" header="Preview" />
      </DataTable>
    </Card>
  );
}

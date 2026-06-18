import { useEffect, useState } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { ProgressSpinner } from "primereact/progressspinner";
import { Card } from "primereact/card";
import { api, type ChunkRecord } from "../api/client";

export function ChunkBrowser() {
  const [chunks, setChunks] = useState<ChunkRecord[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  async function load(sourceFile?: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await api.chunksAll(sourceFile || undefined);
      setChunks(data.chunks);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const sourceFiles = Array.from(new Set(chunks.map((c) => c.sourceFile))).sort();
  const fileOptions = [
    { label: `All files (${chunks.length} chunks)`, value: "" },
    ...sourceFiles.map((f) => ({ label: f, value: f })),
  ];

  async function handleFilterChange(file: string) {
    setSelectedFile(file);
    await load(file || undefined);
  }

  async function handleDeleteFile() {
    if (!selectedFile) return;
    try {
      await api.deleteChunksFile(selectedFile);
      setSelectedFile("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleClearAll() {
    try {
      await api.deleteChunksAll();
      setConfirmClear(false);
      setSelectedFile("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const displayed = selectedFile
    ? chunks.filter((c) => c.sourceFile === selectedFile)
    : chunks;

  return (
    <div>
      <h2>Chunk Browser</h2>
      {error && <Card className="card error mb-3">⚠️ {error}</Card>}

      <div className="toolbar mb-3">
        <Dropdown
          value={selectedFile}
          options={fileOptions}
          onChange={(e) => void handleFilterChange(e.value as string)}
          className="flex-1"
          style={{ minWidth: "200px" }}
        />

        {selectedFile && (
          <Button
            label="Delete file chunks"
            severity="danger"
            size="small"
            onClick={() => void handleDeleteFile()}
          />
        )}

        {!confirmClear ? (
          <Button
            label="Clear all"
            severity="danger"
            size="small"
            onClick={() => setConfirmClear(true)}
          />
        ) : (
          <span className="confirm-inline">
            Sure?&nbsp;
            <Button
              label="Yes, clear all"
              severity="danger"
              size="small"
              onClick={() => void handleClearAll()}
            />
            &nbsp;
            <Button
              label="Cancel"
              size="small"
              outlined
              onClick={() => setConfirmClear(false)}
            />
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center p-8">
          <ProgressSpinner />
        </div>
      ) : (
        <DataTable
          value={displayed}
          dataKey="contentHash"
          size="small"
          stripedRows
          emptyMessage="No chunks found"
          className="chunk-table"
        >
          <Column
            field="sourceFile"
            header="Source file"
            className="source-file"
            style={{ whiteSpace: "nowrap" }}
          />
          <Column
            header="Preview"
            body={(c: ChunkRecord) =>
              c.content.slice(0, 80) + (c.content.length > 80 ? "…" : "")
            }
            className="content-preview"
          />
          <Column
            field="contentHash"
            header="Hash"
            className="hash"
            style={{ whiteSpace: "nowrap", fontSize: "0.8em" }}
          />
        </DataTable>
      )}
    </div>
  );
}

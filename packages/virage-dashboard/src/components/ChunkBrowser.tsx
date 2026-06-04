import { useEffect, useState } from "react";
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

  const sourceFiles = Array.from(
    new Set(chunks.map((c) => c.sourceFile)),
  ).sort();

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
      {error && <div className="card error">⚠️ {error}</div>}

      <div className="toolbar">
        <select
          value={selectedFile}
          onChange={(e) => void handleFilterChange(e.target.value)}
        >
          <option value="">All files ({chunks.length} chunks)</option>
          {sourceFiles.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        {selectedFile && (
          <button
            className="btn-danger"
            onClick={() => void handleDeleteFile()}
          >
            Delete file chunks
          </button>
        )}

        {!confirmClear ? (
          <button className="btn-danger" onClick={() => setConfirmClear(true)}>
            Clear all
          </button>
        ) : (
          <span className="confirm-inline">
            Sure?&nbsp;
            <button
              className="btn-danger"
              onClick={() => void handleClearAll()}
            >
              Yes, clear all
            </button>
            &nbsp;
            <button onClick={() => setConfirmClear(false)}>Cancel</button>
          </span>
        )}
      </div>

      {loading ? (
        <div className="card">Loading...</div>
      ) : (
        <table className="chunk-table">
          <thead>
            <tr>
              <th>Source file</th>
              <th>Preview</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((c) => (
              <tr key={c.contentHash}>
                <td className="source-file">{c.sourceFile}</td>
                <td className="content-preview">
                  {c.content.slice(0, 80)}
                  {c.content.length > 80 ? "…" : ""}
                </td>
                <td className="hash">{c.contentHash}</td>
              </tr>
            ))}
            {displayed.length === 0 && (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", color: "#888" }}>
                  No chunks found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

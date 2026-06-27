import React, { useCallback, useEffect, useState } from "react";
import { DataTable, type DataTablePageEvent } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { ProgressSpinner } from "primereact/progressspinner";
import { Tag } from "primereact/tag";
import { api, type ChunkRecord, type ChunksAllResponse } from "../api/client";

const PAGE_SIZE = 50;

export function ChunkBrowser() {
  const [data, setData] = useState<ChunksAllResponse>({
    chunks: [],
    total: 0,
    page: 0,
    pageSize: PAGE_SIZE,
  });
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [detail, setDetail] = useState<ChunkRecord | null>(null);

  const load = useCallback(async (page: number, sourceFile?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.chunksAll({
        page,
        pageSize: PAGE_SIZE,
        sourceFile: sourceFile || undefined,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFiles = useCallback(async () => {
    try {
      const result = await api.chunkFiles();
      setFiles(result.files);
    } catch {
      /* not fatal */
    }
  }, []);

  useEffect(() => {
    void load(0);
    void loadFiles();
  }, [load, loadFiles]);

  const fileOptions = [
    { label: `All files (${data.total} chunks)`, value: "" },
    ...files.map((f) => ({ label: f, value: f })),
  ];

  async function handleFilterChange(file: string) {
    setSelectedFile(file);
    await load(0, file || undefined);
  }

  function handlePage(e: DataTablePageEvent) {
    void load(
      Math.floor((e.first ?? 0) / PAGE_SIZE),
      selectedFile || undefined,
    );
  }

  async function handleDeleteFile() {
    if (!selectedFile) return;
    try {
      await api.deleteChunksFile(selectedFile);
      setSelectedFile("");
      await load(0);
      await loadFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleClearAll() {
    try {
      await api.deleteChunksAll();
      setConfirmClear(false);
      setSelectedFile("");
      await load(0);
      await loadFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const metaEntries = detail
    ? Object.entries(detail.metadata ?? {}).filter(([k]) => k !== "source_file")
    : [];

  return (
    <div>
      <h2>Chunk Browser</h2>

      {error && <div className="card error mb-3">⚠️ {error}</div>}

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
          value={data.chunks}
          dataKey="id"
          size="small"
          stripedRows
          lazy
          paginator
          rows={PAGE_SIZE}
          totalRecords={data.total}
          first={data.page * PAGE_SIZE}
          onPage={handlePage}
          emptyMessage="No chunks found"
          className="chunk-table"
          onRowClick={(e) => setDetail(e.data as ChunkRecord)}
          rowClassName={() => "cursor-pointer"}
        >
          <Column
            field="sourceFile"
            header="Source file"
            className="source-file"
            style={{ whiteSpace: "nowrap" }}
          />
          <Column
            header="Size"
            body={(c: ChunkRecord) => (
              <Tag
                value={`${(c.denseText ?? c.content ?? "").length} chars`}
                className="text-xs"
              />
            )}
            style={{ whiteSpace: "nowrap", width: "90px" }}
          />
          <Column
            header="Preview"
            body={(c: ChunkRecord) => {
              const text = c.denseText ?? c.content ?? "";
              return (
                <span className="font-mono text-xs text-[#acd]">
                  {text.slice(0, 100)}
                  {text.length > 100 ? "…" : ""}
                </span>
              );
            }}
            className="content-preview"
          />
        </DataTable>
      )}

      {/* Detail dialog */}
      <Dialog
        visible={detail !== null}
        onHide={() => setDetail(null)}
        header={detail?.sourceFile ?? "Chunk detail"}
        maximizable
        style={{ width: "min(800px, 95vw)" }}
        contentClassName="p-0"
      >
        {detail && (
          <div className="flex flex-col gap-4 p-4 font-mono text-sm">
            <section>
              <h4 className="text-[0.7em] text-[#7ec8e3] uppercase tracking-wider m-0 mb-1">
                Dense Text
              </h4>
              <pre className="text-[0.8em] text-[#acd] bg-[#0a1628] p-2 rounded m-0 whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                {detail.denseText ?? detail.content}
              </pre>
            </section>

            {detail.sparseText && (
              <section>
                <h4 className="text-[0.7em] text-[#7ec8e3] uppercase tracking-wider m-0 mb-1">
                  Sparse Text (BM25)
                </h4>
                <pre className="text-[0.8em] text-[#acd] bg-[#0a1628] p-2 rounded m-0 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                  {detail.sparseText}
                </pre>
              </section>
            )}

            {metaEntries.length > 0 && (
              <section>
                <h4 className="text-[0.7em] text-[#7ec8e3] uppercase tracking-wider m-0 mb-1">
                  Metadata
                </h4>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[0.8em] m-0">
                  {metaEntries.map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt className="text-[#7ec8e3] whitespace-nowrap">{k}</dt>
                      <dd className="text-[#cde] m-0 break-all">
                        {typeof v === "string" ? v : JSON.stringify(v)}
                      </dd>
                    </React.Fragment>
                  ))}
                </dl>
              </section>
            )}

            {(detail.sparseTextGeneratorId || detail.metadataGeneratorId) && (
              <section>
                <h4 className="text-[0.7em] text-[#7ec8e3] uppercase tracking-wider m-0 mb-1">
                  Generator IDs
                </h4>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[0.8em] m-0">
                  {detail.sparseTextGeneratorId && (
                    <>
                      <dt className="text-[#7ec8e3] whitespace-nowrap">
                        sparse
                      </dt>
                      <dd className="text-[#cde] m-0 break-all">
                        {detail.sparseTextGeneratorId}
                      </dd>
                    </>
                  )}
                  {detail.metadataGeneratorId && (
                    <>
                      <dt className="text-[#7ec8e3] whitespace-nowrap">
                        metadata
                      </dt>
                      <dd className="text-[#cde] m-0 break-all">
                        {detail.metadataGeneratorId}
                      </dd>
                    </>
                  )}
                </dl>
              </section>
            )}

            <p className="text-[0.72em] text-[#667] m-0">id: {detail.id}</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}

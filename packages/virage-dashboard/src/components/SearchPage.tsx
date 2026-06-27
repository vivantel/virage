import React, { useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Slider } from "primereact/slider";
import { Card } from "primereact/card";
import { Tag } from "primereact/tag";
import { Dropdown } from "primereact/dropdown";
import { ProgressSpinner } from "primereact/progressspinner";
import { api, type SearchResult } from "../api/client";
import { useToast } from "../context/ToastContext";

type SortKey = "similarity" | "chunkSize";

const SORT_OPTIONS = [
  { label: "Vector Similarity", value: "similarity" as SortKey },
  { label: "Chunk Size", value: "chunkSize" as SortKey },
];

function ResultCard({ r }: { r: SearchResult }) {
  const [expanded, setExpanded] = useState(false);
  const sourceFile =
    r.sourceFile ?? (r.metadata["source_file"] as string | undefined) ?? r.id;
  const displayText = r.denseText ?? r.content ?? "";
  const metaEntries = Object.entries(r.metadata).filter(
    ([k]) => k !== "source_file",
  );

  return (
    <div className="bg-[#0f1b2d] border border-[#1e3a5f] rounded-md px-4 py-3 mb-2.5">
      <div className="flex items-center gap-2 flex-wrap min-h-[32px] mb-1">
        <span className="text-[0.78em] text-[#8899bb] font-mono flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {sourceFile}
        </span>
        <Tag
          severity="success"
          value={`${(r.similarity * 100).toFixed(1)}% match`}
        />
        <Button
          text
          size="small"
          icon={expanded ? "pi pi-chevron-up" : "pi pi-chevron-down"}
          label={expanded ? "Collapse" : "Expand"}
          onClick={() => setExpanded((v) => !v)}
        />
      </div>

      <p className="text-sm text-[#cde] mt-2 leading-relaxed whitespace-pre-wrap break-words m-0">
        {expanded
          ? displayText
          : displayText.slice(0, 200) + (displayText.length > 200 ? "…" : "")}
      </p>

      {expanded && (
        <div className="border-t border-[#1e3a5f] mt-3 pt-3 flex flex-col gap-3">
          {r.denseText && (
            <section>
              <h4 className="text-[0.7em] text-[#7ec8e3] uppercase tracking-wider m-0 mb-1">
                Dense Text
              </h4>
              <pre className="font-mono text-[0.8em] text-[#acd] bg-[#0a1628] p-2 rounded m-0 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                {r.denseText}
              </pre>
            </section>
          )}

          {r.contextText && (
            <section>
              <h4 className="text-[0.7em] text-[#7ec8e3] uppercase tracking-wider m-0 mb-1">
                Context (siblings)
              </h4>
              <pre className="font-mono text-[0.8em] text-[#acd] bg-[#0a1628] p-2 rounded m-0 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                {r.contextText}
              </pre>
            </section>
          )}

          {r.sparseText && r.sparseText !== displayText && (
            <section>
              <h4 className="text-[0.7em] text-[#7ec8e3] uppercase tracking-wider m-0 mb-1">
                Sparse Text (BM25)
              </h4>
              <pre className="font-mono text-[0.8em] text-[#acd] bg-[#0a1628] p-2 rounded m-0 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                {r.sparseText}
              </pre>
            </section>
          )}

          {metaEntries.length > 0 && (
            <section>
              <h4 className="text-[0.7em] text-[#7ec8e3] uppercase tracking-wider m-0 mb-1">
                Metadata
              </h4>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[0.8em] m-0">
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

          {(r.sparseTextGeneratorId || r.metadataGeneratorId) && (
            <section>
              <h4 className="text-[0.7em] text-[#7ec8e3] uppercase tracking-wider m-0 mb-1">
                Generator IDs
              </h4>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[0.8em] m-0">
                {r.sparseTextGeneratorId && (
                  <>
                    <dt className="text-[#7ec8e3] whitespace-nowrap">sparse</dt>
                    <dd className="text-[#cde] m-0 break-all">
                      {r.sparseTextGeneratorId}
                    </dd>
                  </>
                )}
                {r.metadataGeneratorId && (
                  <>
                    <dt className="text-[#7ec8e3] whitespace-nowrap">
                      metadata
                    </dt>
                    <dd className="text-[#cde] m-0 break-all">
                      {r.metadataGeneratorId}
                    </dd>
                  </>
                )}
              </dl>
            </section>
          )}

          <p className="text-[0.72em] text-[#667] font-mono mt-1 m-0">
            id: {r.id}
          </p>
        </div>
      )}
    </div>
  );
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("similarity");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const { showError } = useToast();

  const sorted = useMemo(() => {
    const copy = [...results];
    if (sortKey === "chunkSize") {
      copy.sort(
        (a, b) =>
          (b.denseText ?? b.content ?? "").length -
          (a.denseText ?? a.content ?? "").length,
      );
    }
    return copy;
  }, [results, sortKey]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await api.search(query.trim(), topK);
      setResults(data.results);
      setSortKey("similarity");
      setSearched(true);
    } catch (err) {
      showError(
        "Search failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>RAG Search</h2>
      <form onSubmit={(e) => void handleSearch(e)} className="search-form">
        <InputText
          className="w-full mb-3"
          placeholder="Enter a search query…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="search-controls">
          <label className="flex items-center gap-3 flex-1">
            <span>
              Top-K: <strong>{topK}</strong>
            </span>
            <Slider
              value={topK}
              onChange={(e) => setTopK(e.value as number)}
              min={1}
              max={20}
              className="flex-1"
            />
          </label>
          <Button
            type="submit"
            label={loading ? "Searching…" : "Search"}
            icon="pi pi-search"
            disabled={loading || !query.trim()}
          />
        </div>
      </form>

      {loading && (
        <div className="flex justify-center p-8">
          <ProgressSpinner />
        </div>
      )}

      {searched && results.length === 0 && !loading && (
        <Card className="mt-3">No results found.</Card>
      )}

      {sorted.length > 0 && (
        <>
          <div className="flex items-center gap-3 mb-3 mt-2">
            <span className="text-sm text-gray-400">
              {sorted.length} result{sorted.length !== 1 ? "s" : ""}
            </span>
            <label className="flex items-center gap-2 ml-auto">
              <span className="text-sm">Sort by</span>
              <Dropdown
                value={sortKey}
                options={SORT_OPTIONS}
                onChange={(e) => setSortKey(e.value as SortKey)}
                className="text-sm"
              />
            </label>
          </div>

          <Virtuoso
            useWindowScroll
            data={sorted}
            itemContent={(_index, r) => <ResultCard key={r.id} r={r} />}
          />
        </>
      )}
    </div>
  );
}

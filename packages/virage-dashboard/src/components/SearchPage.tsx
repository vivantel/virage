import { useMemo, useState } from "react";
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
    <Card className="search-result-card mb-3">
      <div className="result-header">
        <Tag className="source-badge" value={sourceFile} />
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
          className="ml-auto"
        />
      </div>

      <p className="result-content mt-2">
        {expanded ? displayText : displayText.slice(0, 200) + (displayText.length > 200 ? "…" : "")}
      </p>

      {expanded && (
        <div className="result-details mt-3">
          {r.sparseText && r.sparseText !== displayText && (
            <section className="detail-section">
              <h4 className="detail-label">Sparse Text (BM25)</h4>
              <pre className="detail-pre">{r.sparseText}</pre>
            </section>
          )}

          {metaEntries.length > 0 && (
            <section className="detail-section">
              <h4 className="detail-label">Metadata</h4>
              <dl className="metadata-list">
                {metaEntries.map(([k, v]) => (
                  <div key={k} className="metadata-row">
                    <dt className="metadata-key">{k}</dt>
                    <dd className="metadata-val">
                      {typeof v === "string" ? v : JSON.stringify(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {(r.sparseTextGeneratorId || r.metadataGeneratorId) && (
            <section className="detail-section">
              <h4 className="detail-label">Generator IDs</h4>
              <dl className="metadata-list">
                {r.sparseTextGeneratorId && (
                  <div className="metadata-row">
                    <dt className="metadata-key">sparse</dt>
                    <dd className="metadata-val font-mono text-xs">{r.sparseTextGeneratorId}</dd>
                  </div>
                )}
                {r.metadataGeneratorId && (
                  <div className="metadata-row">
                    <dt className="metadata-key">metadata</dt>
                    <dd className="metadata-val font-mono text-xs">{r.metadataGeneratorId}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          <div className="detail-footer text-xs text-gray-400 mt-2">
            id: <span className="font-mono">{r.id}</span>
          </div>
        </div>
      )}
    </Card>
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

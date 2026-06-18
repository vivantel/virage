import { useState } from "react";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Slider } from "primereact/slider";
import { Card } from "primereact/card";
import { Tag } from "primereact/tag";
import { ProgressSpinner } from "primereact/progressspinner";
import { api, type SearchResult } from "../api/client";
import { useToast } from "../context/ToastContext";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const { showError } = useToast();

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await api.search(query.trim(), topK);
      setResults(data.results);
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

      <div className="search-results">
        {results.map((r) => (
          <Card key={r.id} className="search-result-card">
            <div className="result-header">
              <Tag
                className="source-badge"
                value={
                  r.sourceFile ??
                  (r.metadata["source_file"] as string | undefined) ??
                  r.id
                }
              />
              <Tag
                severity="success"
                value={`${(r.similarity * 100).toFixed(1)}% match`}
              />
            </div>
            <p className="result-content">{r.content}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

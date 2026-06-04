import { useState } from "react";
import { api, type SearchResult } from "../api/client";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.search(query.trim(), topK);
      setResults(data.results);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>RAG Search</h2>
      <form onSubmit={(e) => void handleSearch(e)} className="search-form">
        <input
          type="text"
          className="search-input"
          placeholder="Enter a search query…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="search-controls">
          <label>
            Top-K:&nbsp;
            <input
              type="range"
              min={1}
              max={20}
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
            />
            &nbsp;<strong>{topK}</strong>
          </label>
          <button type="submit" disabled={loading || !query.trim()}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </form>

      {error && <div className="card error">⚠️ {error}</div>}

      {searched && results.length === 0 && !loading && (
        <div className="card">No results found.</div>
      )}

      <div className="search-results">
        {results.map((r) => (
          <div key={r.id} className="search-result-card card">
            <div className="result-header">
              <span className="source-badge">
                {(r.metadata["sourceFile"] as string) ?? r.id}
              </span>
              <span className="similarity-badge">
                {(r.similarity * 100).toFixed(1)}% match
              </span>
            </div>
            <p className="result-content">{r.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  readdirSync,
} from "fs";
import { dirname, join } from "path";
import { rename } from "fs/promises";
import Database from "better-sqlite3";
import type { Chunk } from "../interfaces/index.js";
import type { EmbeddedChunk, EmbeddingsMeta } from "../interfaces/index.js";
import type { ExperimentRun, EvalDataset } from "../interfaces/quality.js";
import type { PipelineRunData } from "./telemetry.js";
import type {
  TelemetrySessionRow,
  TelemetrySearchRow,
  TelemetryLatencyRow,
  TelemetryErrorRow,
  TelemetryFeedbackRow,
  TelemetryCacheStatsRow,
} from "../telemetry/types.js";

function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function chunkContentHash(chunk: Chunk | EmbeddedChunk): string {
  return chunk.contentHash ?? computeContentHash(chunk.content);
}

function embeddingToBlob(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

function blobToEmbedding(blob: Buffer): number[] {
  return Array.from(
    new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4),
  );
}

function parseMetadata(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const META_DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// embedding: raw IEEE-754 float32 little-endian bytes (~4× smaller than JSON).
// NULL until embedded; cleared after upload to reclaim storage.
const CHUNKS_DDL = `
CREATE TABLE IF NOT EXISTS chunks (
  content_hash TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  embedding BLOB,
  embedded_at INTEGER,
  uploaded INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS idx_source_file ON chunks(source_file);
`;

const EXPERIMENT_RUNS_DDL = `
CREATE TABLE IF NOT EXISTS experiment_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  config_json TEXT NOT NULL,
  eval_result_json TEXT NOT NULL,
  ragas_result_json TEXT,
  per_query_rr_scores_json TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_exp_name ON experiment_runs(name);
CREATE INDEX IF NOT EXISTS idx_exp_ts   ON experiment_runs(timestamp);
`;

const EVAL_DATASETS_DDL = `
CREATE TABLE IF NOT EXISTS eval_datasets (
  slot TEXT PRIMARY KEY,
  version TEXT,
  queries_json TEXT NOT NULL,
  saved_at TEXT NOT NULL
) STRICT;
`;

const PIPELINE_RUNS_DDL = `
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  stages_json TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_pipeline_run_at ON pipeline_runs(run_at);
`;

const TELEMETRY_DDL = `
CREATE TABLE IF NOT EXISTS telemetry_sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  embedding_model TEXT,
  chunking_strategy TEXT,
  store_type TEXT,
  node_version TEXT NOT NULL,
  os TEXT NOT NULL,
  total_searches INTEGER NOT NULL DEFAULT 0,
  total_tool_calls INTEGER NOT NULL DEFAULT 0,
  tools_used_json TEXT NOT NULL DEFAULT '[]',
  flushed INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE IF NOT EXISTS telemetry_searches (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  result_count INTEGER NOT NULL,
  result_count_bucket TEXT NOT NULL,
  empty INTEGER NOT NULL,
  query_hash TEXT,
  redundancy_detected INTEGER NOT NULL DEFAULT 0,
  flushed INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS idx_tel_searches_session ON telemetry_searches(session_id);

CREATE TABLE IF NOT EXISTS telemetry_latency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  phase TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  flushed INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS idx_tel_latency_session ON telemetry_latency(session_id);

CREATE TABLE IF NOT EXISTS telemetry_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  error_type TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  recovered INTEGER NOT NULL DEFAULT 0,
  flushed INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE IF NOT EXISTS telemetry_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  search_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  was_useful INTEGER NOT NULL,
  context_relevance REAL,
  context_completeness REAL,
  noise_ratio REAL,
  missing_category TEXT,
  flushed INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE IF NOT EXISTS telemetry_cache_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  file_hit_rate REAL,
  semantic_hit_rate REAL,
  flushed INTEGER NOT NULL DEFAULT 0
) STRICT;
`;

const SEARCH_QUERIES_DDL = `
CREATE TABLE IF NOT EXISTS search_queries (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  query_text TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  result_count INTEGER NOT NULL,
  top_similarity REAL,
  was_empty INTEGER NOT NULL DEFAULT 0,
  hybrid_used INTEGER NOT NULL DEFAULT 0,
  reranked INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS idx_sq_occurred ON search_queries(occurred_at);
CREATE INDEX IF NOT EXISTS idx_sq_hash ON search_queries(query_hash);
`;

export interface SearchQueryRow {
  id: string;
  occurred_at: string;
  query_text: string;
  query_hash: string;
  result_count: number;
  top_similarity: number | null;
  was_empty: number;
  hybrid_used: number;
  reranked: number;
}

export class VirageDb {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });

    // Backward-compat: if virage.db doesn't exist but embeddings.db does, rename it.
    const legacyPath = dbPath.replace(/virage\.db$/, "embeddings.db");
    if (!existsSync(dbPath) && existsSync(legacyPath)) {
      renameSync(legacyPath, dbPath);
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(META_DDL);

    const hasOldTable = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='embeddings'",
      )
      .get() as { name: string } | undefined;
    if (hasOldTable) {
      this.migrateFromEmbeddingsTable();
    }

    this.db.exec(CHUNKS_DDL);
    this.db.exec(EXPERIMENT_RUNS_DDL);
    this.db.exec(EVAL_DATASETS_DDL);
    this.db.exec(PIPELINE_RUNS_DDL);
    this.db.exec(TELEMETRY_DDL);
    this.db.exec(SEARCH_QUERIES_DDL);

    const jsonPath = dbPath.replace(/\.db$/, ".json");
    if (this.isEmpty() && existsSync(jsonPath)) {
      this.migrateFromJson(jsonPath);
    }
  }

  private isEmpty(): boolean {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM chunks").get() as {
      cnt: number;
    };
    return row.cnt === 0;
  }

  private migrateFromEmbeddingsTable(): void {
    type OldRow = {
      content_hash: string;
      source_file: string;
      commit_hash: string;
      content: string;
      metadata_json: string;
      embedding_json: string;
      embedded_at: number;
      uploaded: number;
    };

    const rows = this.db.prepare("SELECT * FROM embeddings").all() as OldRow[];

    const migrate = this.db.transaction(() => {
      this.db
        .prepare(
          `
        CREATE TABLE IF NOT EXISTS chunks (
          content_hash TEXT PRIMARY KEY,
          source_file TEXT NOT NULL,
          commit_hash TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          embedding BLOB,
          embedded_at INTEGER,
          uploaded INTEGER NOT NULL DEFAULT 0
        ) STRICT
      `,
        )
        .run();

      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO chunks
          (content_hash, source_file, commit_hash, content, metadata_json, embedding, embedded_at, uploaded)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const row of rows) {
        let blob: Buffer | null = null;
        if (row.embedding_json) {
          try {
            blob = embeddingToBlob(JSON.parse(row.embedding_json) as number[]);
          } catch {
            /* skip rows with invalid embedding JSON */
          }
        }
        stmt.run(
          row.content_hash,
          row.source_file,
          row.commit_hash,
          row.content,
          row.metadata_json,
          blob,
          row.embedded_at != null ? Math.floor(row.embedded_at) : null,
          row.uploaded,
        );
      }

      this.db.prepare("DROP TABLE embeddings").run();
      this.db.prepare("DROP INDEX IF EXISTS idx_source_file").run();
    });

    migrate();
  }

  getMeta(): EmbeddingsMeta | null {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = 'meta'")
      .get() as { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as EmbeddingsMeta;
    } catch {
      return null;
    }
  }

  setMeta(meta: EmbeddingsMeta): void {
    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('meta', ?)")
      .run(JSON.stringify(meta));
  }

  // ── Streaming pipeline methods ─────────────────────────────────────────────

  /** Insert chunk metadata only (no embedding yet). Safe to call inside a transaction. */
  insertChunk(chunk: Chunk): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO chunks
           (content_hash, source_file, commit_hash, content, metadata_json, embedding, embedded_at, uploaded)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, 0)`,
      )
      .run(
        chunkContentHash(chunk),
        chunk.sourceFile,
        chunk.commitHash,
        chunk.content,
        JSON.stringify(chunk.metadata),
      );
  }

  /** Batch-insert chunk metadata in a single transaction. */
  insertChunks(chunks: Chunk[]): void {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO chunks
         (content_hash, source_file, commit_hash, content, metadata_json, embedding, embedded_at, uploaded)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, 0)`,
    );
    const insertAll = this.db.transaction((items: Chunk[]) => {
      for (const chunk of items) {
        stmt.run(
          chunkContentHash(chunk),
          chunk.sourceFile,
          chunk.commitHash,
          chunk.content,
          JSON.stringify(chunk.metadata),
        );
      }
    });
    insertAll(chunks);
  }

  /** Store the embedding for a previously inserted chunk. */
  updateEmbedding(
    contentHash: string,
    embedding: number[],
    embeddedAt: number,
  ): void {
    this.db
      .prepare(
        "UPDATE chunks SET embedding = ?, embedded_at = ? WHERE content_hash = ?",
      )
      .run(embeddingToBlob(embedding), Math.floor(embeddedAt), contentHash);
  }

  /** Clear embedding data after upload to reclaim storage. */
  clearEmbedding(contentHash: string): void {
    this.db
      .prepare(
        "UPDATE chunks SET embedding = NULL, embedded_at = NULL WHERE content_hash = ?",
      )
      .run(contentHash);
  }

  /** Delete all chunks for a source file (called before re-chunking a changed file). */
  deleteBySourceFile(sourceFile: string): void {
    this.db.prepare("DELETE FROM chunks WHERE source_file = ?").run(sourceFile);
  }

  /**
   * Atomically replace all chunks for a source file with a new set.
   * The delete and insert run in a single SQLite transaction.
   */
  replaceChunks(sourceFile: string, chunks: Chunk[]): void {
    const del = this.db.prepare("DELETE FROM chunks WHERE source_file = ?");
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO chunks
         (content_hash, source_file, commit_hash, content, metadata_json, embedding, embedded_at, uploaded)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, 0)`,
    );
    const txn = this.db.transaction(() => {
      del.run(sourceFile);
      for (const chunk of chunks) {
        ins.run(
          chunkContentHash(chunk),
          chunk.sourceFile,
          chunk.commitHash,
          chunk.content,
          JSON.stringify(chunk.metadata),
        );
      }
    });
    txn();
  }

  /** Chunks inserted during chunking that still need an embedding computed. */
  getPendingEmbedChunks(): Chunk[] {
    type Row = {
      content_hash: string;
      source_file: string;
      commit_hash: string;
      content: string;
      metadata_json: string;
    };
    const rows = this.db
      .prepare(
        "SELECT content_hash, source_file, commit_hash, content, metadata_json FROM chunks WHERE embedding IS NULL AND uploaded = 0",
      )
      .all() as Row[];
    return rows.map((row) => ({
      contentHash: row.content_hash,
      sourceFile: row.source_file,
      commitHash: row.commit_hash,
      content: row.content,
      metadata: parseMetadata(row.metadata_json),
    }));
  }

  /** Embedded chunks that have not yet been uploaded to the vector store. */
  getPendingUploadChunks(): EmbeddedChunk[] {
    return this.rowsToEmbeddedChunks(
      "SELECT * FROM chunks WHERE uploaded = 0 AND embedding IS NOT NULL",
    );
  }

  /** Returns all chunk rows as Chunk objects, regardless of embedding or upload status. */
  getAllChunks(): Chunk[] {
    type Row = {
      content_hash: string;
      source_file: string;
      commit_hash: string;
      content: string;
      metadata_json: string;
    };
    const rows = this.db
      .prepare(
        "SELECT content_hash, source_file, commit_hash, content, metadata_json FROM chunks",
      )
      .all() as Row[];
    return rows.map((row) => ({
      contentHash: row.content_hash,
      sourceFile: row.source_file,
      commitHash: row.commit_hash,
      content: row.content,
      metadata: parseMetadata(row.metadata_json),
    }));
  }

  /** Returns a file → commitHash map for all files tracked in the DB. */
  getFileStates(): Map<string, string> {
    type Row = { source_file: string; commit_hash: string };
    const rows = this.db
      .prepare(
        "SELECT source_file, commit_hash FROM chunks GROUP BY source_file",
      )
      .all() as Row[];
    return new Map(rows.map((r) => [r.source_file, r.commit_hash]));
  }

  // ── Preserved methods ──────────────────────────────────────────────────────

  /** Insert fully-embedded chunks (used by migration and legacy callers). */
  insert(chunks: EmbeddedChunk[]): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO chunks
        (content_hash, source_file, commit_hash, content, metadata_json, embedding, embedded_at, uploaded)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);
    const insertMany = this.db.transaction((items: EmbeddedChunk[]) => {
      for (const chunk of items) {
        stmt.run(
          chunkContentHash(chunk),
          chunk.sourceFile,
          chunk.commitHash,
          chunk.content,
          JSON.stringify(chunk.metadata),
          embeddingToBlob(chunk.embedding),
          Math.floor(chunk.embeddedAt),
        );
      }
    });
    insertMany(chunks);
  }

  has(contentHash: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM chunks WHERE content_hash = ?")
      .get(contentHash);
    return row !== undefined;
  }

  /** Returns all rows that have an embedding (excludes metadata-only rows). */
  getAll(): EmbeddedChunk[] {
    return this.rowsToEmbeddedChunks(
      "SELECT * FROM chunks WHERE embedding IS NOT NULL",
    );
  }

  /** Alias for getPendingUploadChunks() — keeps Uploader compatible. */
  getPending(): EmbeddedChunk[] {
    return this.getPendingUploadChunks();
  }

  markUploaded(contentHashes: string[]): void {
    if (contentHashes.length === 0) return;
    const placeholders = contentHashes.map(() => "?").join(", ");
    this.db
      .prepare(
        `UPDATE chunks SET uploaded = 1 WHERE content_hash IN (${placeholders})`,
      )
      .run(...contentHashes);
  }

  /** Count of embedded chunks not yet uploaded. */
  pendingCount(): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as cnt FROM chunks WHERE uploaded = 0 AND embedding IS NOT NULL",
      )
      .get() as { cnt: number };
    return row.cnt;
  }

  clearAll(): void {
    this.db.prepare("DELETE FROM chunks").run();
    this.db.prepare("DELETE FROM meta").run();
  }

  pruneUploaded(): void {
    this.db.prepare("DELETE FROM chunks WHERE uploaded = 1").run();
  }

  migrateFromJson(jsonPath: string): void {
    let raw: string;
    try {
      raw = readFileSync(jsonPath, "utf-8");
    } catch {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    let chunks: EmbeddedChunk[];
    let meta: EmbeddingsMeta | null = null;

    if (Array.isArray(parsed)) {
      chunks = parsed as EmbeddedChunk[];
    } else {
      const file = parsed as {
        _meta?: EmbeddingsMeta;
        chunks?: EmbeddedChunk[];
      };
      chunks = file.chunks ?? [];
      meta = file._meta ?? null;
    }

    if (meta) this.setMeta(meta);
    if (chunks.length > 0) {
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO chunks
          (content_hash, source_file, commit_hash, content, metadata_json, embedding, embedded_at, uploaded)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `);
      const insertAll = this.db.transaction((items: EmbeddedChunk[]) => {
        for (const chunk of items) {
          stmt.run(
            chunkContentHash(chunk),
            chunk.sourceFile,
            chunk.commitHash,
            chunk.content,
            JSON.stringify(chunk.metadata),
            embeddingToBlob(chunk.embedding),
            Math.floor(chunk.embeddedAt),
          );
        }
      });
      insertAll(chunks);
    }

    rename(jsonPath, jsonPath + ".migrated").catch(() => {});
  }

  close(): void {
    this.db.close();
  }

  private rowsToEmbeddedChunks(sql: string): EmbeddedChunk[] {
    type Row = {
      content_hash: string;
      source_file: string;
      commit_hash: string;
      content: string;
      metadata_json: string;
      embedding: Buffer;
      embedded_at: number;
    };
    const rows = this.db.prepare(sql).all() as Row[];
    return rows.map((row) => ({
      contentHash: row.content_hash,
      sourceFile: row.source_file,
      commitHash: row.commit_hash,
      content: row.content,
      metadata: parseMetadata(row.metadata_json),
      embedding: blobToEmbedding(row.embedding),
      embeddedAt: row.embedded_at,
    }));
  }

  // ── Experiment runs ────────────────────────────────────────────────────────

  saveExperimentRun(run: ExperimentRun): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO experiment_runs
           (id, name, timestamp, config_json, eval_result_json, ragas_result_json, per_query_rr_scores_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.name,
        run.timestamp,
        JSON.stringify(run.config),
        JSON.stringify(run.evalResult),
        run.ragasResult != null ? JSON.stringify(run.ragasResult) : null,
        run.perQueryRrScores != null
          ? JSON.stringify(run.perQueryRrScores)
          : null,
      );
  }

  loadExperimentRun(nameOrId: string): ExperimentRun | null {
    type Row = {
      id: string;
      name: string;
      timestamp: string;
      config_json: string;
      eval_result_json: string;
      ragas_result_json: string | null;
      per_query_rr_scores_json: string | null;
    };

    let row = this.db
      .prepare("SELECT * FROM experiment_runs WHERE id = ?")
      .get(nameOrId) as Row | undefined;

    if (!row) {
      row = this.db
        .prepare(
          "SELECT * FROM experiment_runs WHERE name = ? ORDER BY timestamp DESC LIMIT 1",
        )
        .get(nameOrId) as Row | undefined;
    }

    if (!row) return null;
    return this.rowToExperimentRun(row);
  }

  listExperimentRuns(): ExperimentRun[] {
    type Row = {
      id: string;
      name: string;
      timestamp: string;
      config_json: string;
      eval_result_json: string;
      ragas_result_json: string | null;
      per_query_rr_scores_json: string | null;
    };
    const rows = this.db
      .prepare("SELECT * FROM experiment_runs ORDER BY timestamp ASC")
      .all() as Row[];
    return rows.map((r) => this.rowToExperimentRun(r));
  }

  deleteExperimentRun(id: string): void {
    const result = this.db
      .prepare("DELETE FROM experiment_runs WHERE id = ?")
      .run(id);
    if (result.changes === 0) {
      throw new Error(`Experiment run "${id}" not found.`);
    }
  }

  migrateExperimentsFromDir(dir: string): void {
    if (!existsSync(dir)) return;
    const count = (
      this.db.prepare("SELECT COUNT(*) as cnt FROM experiment_runs").get() as {
        cnt: number;
      }
    ).cnt;
    if (count > 0) return;

    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      return;
    }

    for (const file of files) {
      try {
        const raw = readFileSync(join(dir, file), "utf-8");
        const run = JSON.parse(raw) as ExperimentRun;
        this.saveExperimentRun(run);
      } catch {
        /* skip malformed files */
      }
    }
  }

  private rowToExperimentRun(row: {
    id: string;
    name: string;
    timestamp: string;
    config_json: string;
    eval_result_json: string;
    ragas_result_json: string | null;
    per_query_rr_scores_json: string | null;
  }): ExperimentRun {
    return {
      id: row.id,
      name: row.name,
      timestamp: row.timestamp,
      config: JSON.parse(row.config_json) as Record<string, unknown>,
      evalResult: JSON.parse(row.eval_result_json),
      ragasResult:
        row.ragas_result_json != null
          ? JSON.parse(row.ragas_result_json)
          : undefined,
      perQueryRrScores:
        row.per_query_rr_scores_json != null
          ? JSON.parse(row.per_query_rr_scores_json)
          : undefined,
    };
  }

  // ── Eval datasets ──────────────────────────────────────────────────────────

  saveEvalDataset(dataset: EvalDataset, slot: string = "default"): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO eval_datasets (slot, version, queries_json, saved_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        slot,
        dataset.version ?? null,
        JSON.stringify(dataset.queries),
        new Date().toISOString(),
      );
  }

  loadEvalDataset(slot: string = "default"): EvalDataset | null {
    const row = this.db
      .prepare("SELECT * FROM eval_datasets WHERE slot = ?")
      .get(slot) as
      | { slot: string; version: string | null; queries_json: string }
      | undefined;
    if (!row) return null;
    return {
      queries: JSON.parse(row.queries_json),
      ...(row.version != null ? { version: row.version } : {}),
    };
  }

  // ── Pipeline runs ──────────────────────────────────────────────────────────

  savePipelineRun(data: PipelineRunData): void {
    this.db
      .prepare(
        `INSERT INTO pipeline_runs (run_at, duration_ms, stages_json)
         VALUES (?, ?, ?)`,
      )
      .run(data.runAt, data.durationMs, JSON.stringify(data.stages));
  }

  listPipelineRuns(limit: number = 100): PipelineRunData[] {
    type Row = {
      run_at: string;
      duration_ms: number;
      stages_json: string;
    };
    const rows = this.db
      .prepare(
        "SELECT run_at, duration_ms, stages_json FROM pipeline_runs ORDER BY run_at ASC LIMIT ?",
      )
      .all(limit) as Row[];
    return rows.map((r) => ({
      runAt: r.run_at,
      durationMs: r.duration_ms,
      stages: JSON.parse(r.stages_json),
    }));
  }

  // ── Telemetry: sessions ────────────────────────────────────────────────────

  insertTelemetrySession(row: TelemetrySessionRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO telemetry_sessions
           (id, started_at, ended_at, embedding_model, chunking_strategy, store_type,
            node_version, os, total_searches, total_tool_calls, tools_used_json, flushed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.started_at,
        row.ended_at ?? null,
        row.embedding_model ?? null,
        row.chunking_strategy ?? null,
        row.store_type ?? null,
        row.node_version,
        row.os,
        row.total_searches,
        row.total_tool_calls,
        row.tools_used_json,
        row.flushed,
      );
  }

  updateTelemetrySession(
    id: string,
    updates: Partial<Omit<TelemetrySessionRow, "id">>,
  ): void {
    const fields = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(", ");
    const values = Object.values(updates);
    if (!fields) return;
    this.db
      .prepare(`UPDATE telemetry_sessions SET ${fields} WHERE id = ?`)
      .run(...values, id);
  }

  getTelemetrySession(id: string): TelemetrySessionRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM telemetry_sessions WHERE id = ?")
        .get(id) as TelemetrySessionRow | undefined) ?? null
    );
  }

  getUnflushedSessions(): TelemetrySessionRow[] {
    return this.db
      .prepare("SELECT * FROM telemetry_sessions WHERE flushed = 0")
      .all() as TelemetrySessionRow[];
  }

  markTelemetryFlushed(sessionId: string): void {
    this.db
      .prepare("UPDATE telemetry_sessions SET flushed = 1 WHERE id = ?")
      .run(sessionId);
    this.db
      .prepare("UPDATE telemetry_searches SET flushed = 1 WHERE session_id = ?")
      .run(sessionId);
    this.db
      .prepare("UPDATE telemetry_latency SET flushed = 1 WHERE session_id = ?")
      .run(sessionId);
    this.db
      .prepare("UPDATE telemetry_errors SET flushed = 1 WHERE session_id = ?")
      .run(sessionId);
    this.db
      .prepare("UPDATE telemetry_feedback SET flushed = 1 WHERE session_id = ?")
      .run(sessionId);
    this.db
      .prepare(
        "UPDATE telemetry_cache_stats SET flushed = 1 WHERE session_id = ?",
      )
      .run(sessionId);
  }

  // ── Telemetry: searches ────────────────────────────────────────────────────

  insertTelemetrySearch(row: TelemetrySearchRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO telemetry_searches
           (id, session_id, occurred_at, result_count, result_count_bucket,
            empty, query_hash, redundancy_detected, flushed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.session_id,
        row.occurred_at,
        row.result_count,
        row.result_count_bucket,
        row.empty,
        row.query_hash ?? null,
        row.redundancy_detected,
        row.flushed,
      );
  }

  getSearchesForSession(sessionId: string): TelemetrySearchRow[] {
    return this.db
      .prepare(
        "SELECT * FROM telemetry_searches WHERE session_id = ? ORDER BY occurred_at ASC",
      )
      .all(sessionId) as TelemetrySearchRow[];
  }

  // ── Telemetry: latency ─────────────────────────────────────────────────────

  insertTelemetryLatency(row: Omit<TelemetryLatencyRow, "id">): void {
    this.db
      .prepare(
        `INSERT INTO telemetry_latency
           (session_id, occurred_at, phase, duration_ms, flushed)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        row.session_id,
        row.occurred_at,
        row.phase,
        row.duration_ms,
        row.flushed,
      );
  }

  getLatencyForSession(sessionId: string): TelemetryLatencyRow[] {
    return this.db
      .prepare(
        "SELECT * FROM telemetry_latency WHERE session_id = ? ORDER BY occurred_at ASC",
      )
      .all(sessionId) as TelemetryLatencyRow[];
  }

  // ── Telemetry: errors ──────────────────────────────────────────────────────

  insertTelemetryError(row: Omit<TelemetryErrorRow, "id">): void {
    this.db
      .prepare(
        `INSERT INTO telemetry_errors
           (session_id, occurred_at, error_type, retry_count, recovered, flushed)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.session_id,
        row.occurred_at,
        row.error_type,
        row.retry_count,
        row.recovered,
        row.flushed,
      );
  }

  getErrorsForSession(sessionId: string): TelemetryErrorRow[] {
    return this.db
      .prepare(
        "SELECT * FROM telemetry_errors WHERE session_id = ? ORDER BY occurred_at ASC",
      )
      .all(sessionId) as TelemetryErrorRow[];
  }

  // ── Telemetry: feedback ────────────────────────────────────────────────────

  insertTelemetryFeedback(row: Omit<TelemetryFeedbackRow, "id">): void {
    this.db
      .prepare(
        `INSERT INTO telemetry_feedback
           (session_id, search_id, occurred_at, was_useful,
            context_relevance, context_completeness, noise_ratio,
            missing_category, flushed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.session_id,
        row.search_id,
        row.occurred_at,
        row.was_useful,
        row.context_relevance ?? null,
        row.context_completeness ?? null,
        row.noise_ratio ?? null,
        row.missing_category ?? null,
        row.flushed,
      );
  }

  getFeedbackForSession(sessionId: string): TelemetryFeedbackRow[] {
    return this.db
      .prepare(
        "SELECT * FROM telemetry_feedback WHERE session_id = ? ORDER BY occurred_at ASC",
      )
      .all(sessionId) as TelemetryFeedbackRow[];
  }

  // ── Telemetry: cache stats ─────────────────────────────────────────────────

  insertTelemetryCacheStats(row: Omit<TelemetryCacheStatsRow, "id">): void {
    this.db
      .prepare(
        `INSERT INTO telemetry_cache_stats
           (session_id, recorded_at, file_hit_rate, semantic_hit_rate, flushed)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        row.session_id,
        row.recorded_at,
        row.file_hit_rate ?? null,
        row.semantic_hit_rate ?? null,
        row.flushed,
      );
  }

  getCacheStatsForSession(sessionId: string): TelemetryCacheStatsRow[] {
    return this.db
      .prepare(
        "SELECT * FROM telemetry_cache_stats WHERE session_id = ? ORDER BY recorded_at ASC",
      )
      .all(sessionId) as TelemetryCacheStatsRow[];
  }

  // ── Telemetry: buffer management ───────────────────────────────────────────

  getTelemetryBufferSizeBytes(): number {
    const tables = [
      "telemetry_sessions",
      "telemetry_searches",
      "telemetry_latency",
      "telemetry_errors",
      "telemetry_feedback",
      "telemetry_cache_stats",
    ];
    let totalBytes = 0;
    for (const table of tables) {
      const row = this.db
        .prepare(
          `SELECT SUM(LENGTH(CAST(rowid AS TEXT)) + 50) as sz FROM ${table}`,
        )
        .get() as { sz: number | null };
      totalBytes += row.sz ?? 0;
    }
    return totalBytes;
  }

  pruneOldTelemetry(maxBytes: number): void {
    const currentSize = this.getTelemetryBufferSizeBytes();
    if (currentSize <= maxBytes) return;

    // Delete oldest latency rows first, then cache stats — never sessions/errors/feedback
    this.db
      .prepare(
        `DELETE FROM telemetry_latency WHERE id IN (
           SELECT id FROM telemetry_latency ORDER BY occurred_at ASC LIMIT 1000
         )`,
      )
      .run();

    if (this.getTelemetryBufferSizeBytes() > maxBytes) {
      this.db
        .prepare(
          `DELETE FROM telemetry_cache_stats WHERE id IN (
             SELECT id FROM telemetry_cache_stats ORDER BY recorded_at ASC LIMIT 1000
           )`,
        )
        .run();
    }
  }

  hasTelemetrySessions(): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM telemetry_sessions")
      .get() as { cnt: number };
    return row.cnt > 0;
  }

  clearTelemetryData(): void {
    const tables = [
      "telemetry_cache_stats",
      "telemetry_feedback",
      "telemetry_errors",
      "telemetry_latency",
      "telemetry_searches",
      "telemetry_sessions",
    ];
    for (const table of tables) {
      this.db.prepare(`DELETE FROM ${table}`).run();
    }
  }

  // ── Query analytics ────────────────────────────────────────────────────────

  insertSearchQuery(row: SearchQueryRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO search_queries
           (id, occurred_at, query_text, query_hash, result_count,
            top_similarity, was_empty, hybrid_used, reranked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.occurred_at,
        row.query_text,
        row.query_hash,
        row.result_count,
        row.top_similarity ?? null,
        row.was_empty,
        row.hybrid_used,
        row.reranked,
      );
  }

  getRecentSearchQueries(limit = 50): SearchQueryRow[] {
    return this.db
      .prepare(
        "SELECT * FROM search_queries ORDER BY occurred_at DESC LIMIT ?",
      )
      .all(limit) as SearchQueryRow[];
  }

  getTopSearchTerms(limit = 20): { query_text: string; count: number }[] {
    return this.db
      .prepare(
        `SELECT query_text, COUNT(*) as count
         FROM search_queries
         GROUP BY query_hash
         ORDER BY count DESC
         LIMIT ?`,
      )
      .all(limit) as { query_text: string; count: number }[];
  }

  getZeroResultQueries(
    threshold = 0.5,
    limit = 50,
  ): SearchQueryRow[] {
    return this.db
      .prepare(
        `SELECT * FROM search_queries
         WHERE was_empty = 1 OR (top_similarity IS NOT NULL AND top_similarity < ?)
         ORDER BY occurred_at DESC
         LIMIT ?`,
      )
      .all(threshold, limit) as SearchQueryRow[];
  }

  getSearchStats(): {
    queriesLastHour: number;
    queriesLast24h: number;
    avgTopSimilarity: number;
    zeroResultRate: number;
  } {
    const now = new Date().toISOString();
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

    const lastHour = (
      this.db
        .prepare(
          "SELECT COUNT(*) as cnt FROM search_queries WHERE occurred_at >= ?",
        )
        .get(hourAgo) as { cnt: number }
    ).cnt;

    const last24h = (
      this.db
        .prepare(
          "SELECT COUNT(*) as cnt FROM search_queries WHERE occurred_at >= ?",
        )
        .get(dayAgo) as { cnt: number }
    ).cnt;

    const avgRow = this.db
      .prepare(
        "SELECT AVG(top_similarity) as avg FROM search_queries WHERE top_similarity IS NOT NULL",
      )
      .get() as { avg: number | null };

    const totalRow = this.db
      .prepare("SELECT COUNT(*) as cnt FROM search_queries")
      .get() as { cnt: number };

    const emptyRow = this.db
      .prepare("SELECT COUNT(*) as cnt FROM search_queries WHERE was_empty = 1")
      .get() as { cnt: number };

    // suppress unused variable warning — now is used for context only
    void now;

    return {
      queriesLastHour: lastHour,
      queriesLast24h: last24h,
      avgTopSimilarity: avgRow.avg ?? 0,
      zeroResultRate:
        totalRow.cnt > 0 ? emptyRow.cnt / totalRow.cnt : 0,
    };
  }

  getQueriesPerHour(hours = 24): { hour: string; count: number }[] {
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();
    return this.db
      .prepare(
        `SELECT strftime('%Y-%m-%dT%H:00:00Z', occurred_at) as hour,
                COUNT(*) as count
         FROM search_queries
         WHERE occurred_at >= ?
         GROUP BY hour
         ORDER BY hour ASC`,
      )
      .all(since) as { hour: string; count: number }[];
  }
}

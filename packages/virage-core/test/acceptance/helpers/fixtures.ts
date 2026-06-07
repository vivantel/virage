import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import Database from "better-sqlite3";
import { VirageDb } from "../../../src/core/virage-db.js";

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

/** Path where the CLI looks for virage.db when run with cwd=dir (no VIRAGE_DIR override). */
function virageDbPath(dir: string): string {
  return join(dir, ".virage", "virage.db");
}

/** Write a minimal virage SQLite DB with `count` embedded chunks. */
export function writeVirageDb(dir: string, count = 10, dim = 384): void {
  const path = virageDbPath(dir);
  ensureDir(path);
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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
  `);
  const insert = raw.prepare(
    "INSERT INTO chunks (content_hash, source_file, commit_hash, content, metadata_json, embedding, embedded_at, uploaded) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
  );
  const embedding = Buffer.from(
    new Float32Array(new Array(dim).fill(0.0)).buffer,
  );
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < count; i++) {
    insert.run(
      `hash${i}`,
      `skills/file${i % 3}.md`,
      "abc123",
      `Chunk content ${i}. This is a sentence ending properly.`,
      JSON.stringify({
        strategy: "markdownHeaders",
        heading: `## Section ${i}`,
      }),
      embedding,
      now,
    );
  }
  raw.close();
}

/** Write a pipeline run record into virage.db for the `report` command. */
export function writePipelineRunToDb(dir: string): void {
  const dbPath = virageDbPath(dir);
  ensureDir(dbPath);
  const db = new VirageDb(dbPath);
  try {
    db.savePipelineRun({
      runAt: new Date().toISOString(),
      durationMs: 4200,
      stages: {
        gitTracking: {
          durationMs: 120,
          filesScanned: 35,
          toProcess: 35,
          toDelete: 0,
        },
        chunking: {
          durationMs: 80,
          filesProcessed: 35,
          chunksGenerated: 225,
          errors: 0,
        },
        embedding: {
          durationMs: 118000,
          chunksEmbedded: 225,
          chunksSkipped: 0,
          rateLimitEvents: 0,
          latencySamples: [],
        },
        upload: { durationMs: 200, uploaded: 225, deleted: 0 },
      },
    });
  } finally {
    db.close();
  }
}

/** Write a fake experiment run into virage.db and return its id. */
export function writeExperimentRun(
  dir: string,
  name: string,
  mrr = 0.75,
): string {
  const dbPath = virageDbPath(dir);
  ensureDir(dbPath);
  const db = new VirageDb(dbPath);
  const id = `${name}-${Date.now()}`;
  try {
    db.saveExperimentRun({
      id,
      name,
      timestamp: new Date().toISOString(),
      config: { configFile: "./virage.config.json" },
      evalResult: {
        mrr,
        precisionAt5: 0.8,
        precisionAt10: 0.7,
        recallAt10: 0.65,
        hitRateAt5: 0.9,
        queriesEvaluated: 5,
      },
      perQueryRrScores: Array.from({ length: 5 }, (_, i) => (i + 1) * 0.1),
    });
  } finally {
    db.close();
  }
  return id;
}

/** Write a minimal virage.config.json pointing at the test store. */
export function writeConfig(
  dir: string,
  options: { storePkg: string; cacheDir?: string } = {
    storePkg: "@vivantel/virage-store-test",
  },
): void {
  const cfg = {
    chunkers: [{ patterns: ["**/*.md"], strategy: "markdownHeaders" }],
    embedder: {
      package: "@vivantel/virage-embedder-fastembed",
      config: {
        model: "fast-bge-small-en-v1.5",
        dimensions: 384,
        ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
      },
    },
    vectorStore: {
      package: options.storePkg,
      config: { path: "./rag-test/vector-store.json" },
    },
  };
  writeFileSync(join(dir, "virage.config.json"), JSON.stringify(cfg, null, 2));
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases
// ---------------------------------------------------------------------------

/** @deprecated Use writeVirageDb instead. */
export const writeEmbeddingsDb = writeVirageDb;

/** @deprecated Use writePipelineRunToDb instead. */
export function writeTelemetry(dir: string): void {
  writePipelineRunToDb(dir);
}

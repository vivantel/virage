import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import Database from 'better-sqlite3';

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

/** Write a minimal virage embeddings SQLite DB with `count` embedded chunks. */
export function writeEmbeddingsDb(dir: string, count = 10, dim = 384): void {
  const path = join(dir, 'rag-test', 'embeddings.db');
  ensureDir(path);
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
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
  const insert = db.prepare(
    'INSERT INTO chunks (content_hash, source_file, commit_hash, content, metadata_json, embedding, embedded_at, uploaded) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
  );
  const embedding = Buffer.from(new Float32Array(new Array(dim).fill(0.0)).buffer);
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < count; i++) {
    insert.run(
      `hash${i}`,
      `skills/file${i % 3}.md`,
      'abc123',
      `Chunk content ${i}. This is a sentence ending properly.`,
      JSON.stringify({ strategy: 'markdownHeaders', heading: `## Section ${i}` }),
      embedding,
      now,
    );
  }
  db.close();
}

/** Write a minimal telemetry.json that the `report` command can parse. */
export function writeTelemetry(dir: string): void {
  const record = {
    runAt: new Date().toISOString(),
    durationMs: 4200,
    stages: {
      gitTracking: { durationMs: 120, filesScanned: 35, toProcess: 35, toDelete: 0 },
      chunking: { durationMs: 80, filesProcessed: 35, chunksGenerated: 225, errors: 0 },
      embedding: {
        durationMs: 118000,
        chunksEmbedded: 225,
        chunksSkipped: 0,
        rateLimitEvents: 0,
        apiLatenciesMs: [],
      },
      upload: { durationMs: 200, uploaded: 225, deleted: 0 },
    },
  };
  const path = join(dir, 'rag-test', 'telemetry.json');
  ensureDir(path);
  writeFileSync(path, JSON.stringify(record, null, 2));
}

/** Write a fake experiment run and return its id. */
export function writeExperimentRun(
  dir: string,
  name: string,
  mrr = 0.75,
): string {
  const id = `${name}-${Date.now()}`;
  const run = {
    id,
    name,
    createdAt: new Date().toISOString(),
    metrics: {
      mrr,
      precisionAt5: 0.8,
      precisionAt10: 0.7,
      recallAt10: 0.65,
      hitRateAt5: 0.9,
    },
    perQueryRR: Array.from({ length: 5 }, () => Math.random()),
  };
  const path = join(dir, '.claude', 'experiments', `${id}.json`);
  ensureDir(path);
  writeFileSync(path, JSON.stringify(run, null, 2));
  return id;
}

/** Write a minimal virage.config.json pointing at the test store. */
export function writeConfig(
  dir: string,
  options: { storePkg: string; cacheDir?: string } = { storePkg: '@vivantel/virage-store-test' },
): void {
  const cfg = {
    chunkers: [{ patterns: ['**/*.md'], strategy: 'markdownHeaders' }],
    embedder: {
      package: '@vivantel/virage-embedder-fastembed',
      config: {
        model: 'fast-bge-small-en-v1.5',
        dimensions: 384,
        ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
      },
    },
    vectorStore: {
      package: options.storePkg,
      config: { path: './rag-test/vector-store.json' },
    },
  };
  writeFileSync(join(dir, 'virage.config.json'), JSON.stringify(cfg, null, 2));
}

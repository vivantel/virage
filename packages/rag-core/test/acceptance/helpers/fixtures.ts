import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

/** Write a minimal chunks.json with `count` stub chunks. */
export function writeChunks(dir: string, count = 10): void {
  const chunks = Array.from({ length: count }, (_, i) => ({
    content: `Chunk content ${i}. This is a sentence ending properly.`,
    sourceFile: `skills/file${i % 3}.md`,
    commitHash: 'abc123',
    contentHash: `hash${i}`,
    metadata: { strategy: 'markdownHeaders', heading: `## Section ${i}` },
  }));
  const path = join(dir, 'rag-test', 'chunks.json');
  ensureDir(path);
  writeFileSync(path, JSON.stringify(chunks, null, 2));
}

/** Write a minimal embeddings.json with 384-dim zero vectors. */
export function writeEmbeddings(dir: string, count = 10, dim = 384): void {
  const embedding = Object.fromEntries(Array.from({ length: dim }, (_, i) => [String(i), 0.0]));
  const chunks = Array.from({ length: count }, (_, i) => ({
    content: `Chunk ${i}`,
    sourceFile: `skills/file${i % 3}.md`,
    commitHash: 'abc123',
    contentHash: `hash${i}`,
    embedding,
    embeddedAt: new Date().toISOString(),
    metadata: {},
  }));
  const record = {
    _meta: {
      schemaVersion: 1,
      providerName: 'fastembed',
      providerDimensions: dim,
      model: 'fast-bge-small-en-v1.5',
      vectorStoreName: 'file-test-store',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    chunks,
  };
  const path = join(dir, 'rag-test', 'embeddings.json');
  ensureDir(path);
  writeFileSync(path, JSON.stringify(record, null, 2));
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

/** Write a minimal rag.config.json pointing at the test store. */
export function writeConfig(
  dir: string,
  options: { storePkg: string; cacheDir?: string } = { storePkg: '@vivantel/rag-store-test' },
): void {
  const cfg = {
    chunkers: [{ patterns: ['**/*.md'], strategy: 'markdownHeaders' }],
    embedder: {
      package: '@vivantel/rag-embedder-fastembed',
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
    options: {
      chunksFile: './rag-test/chunks.json',
      embeddingsFile: './rag-test/embeddings.json',
    },
  };
  writeFileSync(join(dir, 'rag.config.json'), JSON.stringify(cfg, null, 2));
}

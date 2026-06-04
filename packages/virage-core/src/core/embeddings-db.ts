import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { rename } from "fs/promises";
import Database from "better-sqlite3";
import type { Chunk } from "../interfaces/index.js";
import type { EmbeddedChunk, EmbeddingsMeta } from "../interfaces/index.js";

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

export class EmbeddingsDb {
  private db: Database.Database;

  constructor(dbPath: string) {
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
}

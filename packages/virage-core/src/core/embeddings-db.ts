import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { rename } from "fs/promises";
import Database from "better-sqlite3";
import type { EmbeddedChunk, EmbeddingsMeta } from "../interfaces/index.js";

function chunkContentHash(chunk: EmbeddedChunk): string {
  return (
    chunk.contentHash ??
    createHash("sha256").update(chunk.content).digest("hex").slice(0, 16)
  );
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS embeddings (
  content_hash TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  embedded_at INTEGER NOT NULL,
  uploaded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_source_file ON embeddings(source_file);
`;

export class EmbeddingsDb {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);

    const jsonPath = dbPath.replace(/\.db$/, ".json");
    if (this.isEmpty() && existsSync(jsonPath)) {
      this.migrateFromJson(jsonPath);
    }
  }

  private isEmpty(): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM embeddings")
      .get() as { cnt: number };
    return row.cnt === 0;
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

  insert(chunks: EmbeddedChunk[]): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO embeddings
        (content_hash, source_file, commit_hash, content, metadata_json, embedding_json, embedded_at, uploaded)
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
          JSON.stringify(chunk.embedding),
          chunk.embeddedAt,
        );
      }
    });
    insertMany(chunks);
  }

  has(contentHash: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM embeddings WHERE content_hash = ?")
      .get(contentHash);
    return row !== undefined;
  }

  getAll(): EmbeddedChunk[] {
    return this.rows("SELECT * FROM embeddings");
  }

  getPending(): EmbeddedChunk[] {
    return this.rows("SELECT * FROM embeddings WHERE uploaded = 0");
  }

  markUploaded(contentHashes: string[]): void {
    if (contentHashes.length === 0) return;
    const placeholders = contentHashes.map(() => "?").join(", ");
    this.db
      .prepare(
        `UPDATE embeddings SET uploaded = 1 WHERE content_hash IN (${placeholders})`,
      )
      .run(...contentHashes);
  }

  pendingCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM embeddings WHERE uploaded = 0")
      .get() as { cnt: number };
    return row.cnt;
  }

  clearAll(): void {
    this.db.prepare("DELETE FROM embeddings").run();
    this.db.prepare("DELETE FROM meta").run();
  }

  pruneUploaded(): void {
    this.db.prepare("DELETE FROM embeddings WHERE uploaded = 1").run();
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
      // Mark migrated chunks as uploaded since they were previously written to JSON
      // (implying they were already synced to the vector store)
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO embeddings
          (content_hash, source_file, commit_hash, content, metadata_json, embedding_json, embedded_at, uploaded)
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
            JSON.stringify(chunk.embedding),
            chunk.embeddedAt,
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

  private rows(sql: string): EmbeddedChunk[] {
    type Row = {
      content_hash: string;
      source_file: string;
      commit_hash: string;
      content: string;
      metadata_json: string;
      embedding_json: string;
      embedded_at: number;
      uploaded: number;
    };
    const rows = this.db.prepare(sql).all() as Row[];
    return rows.map((row) => ({
      contentHash: row.content_hash,
      sourceFile: row.source_file,
      commitHash: row.commit_hash,
      content: row.content,
      metadata: (() => {
        try {
          return JSON.parse(row.metadata_json) as Record<string, unknown>;
        } catch {
          return {};
        }
      })(),
      embedding: (() => {
        try {
          return JSON.parse(row.embedding_json) as number[];
        } catch {
          return [];
        }
      })(),
      embeddedAt: row.embedded_at,
    }));
  }
}

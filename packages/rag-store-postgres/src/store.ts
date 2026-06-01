import type {
  VectorStore,
  VectorSearchResult,
  IndexStats,
  QueryPerfReport,
} from "@vivantel/rag-core";
import pg from "pg";
import pgvector from "pgvector/pg";
import { getIndexStats } from "./stats.js";
import { getQueryPerfReport } from "./query-perf.js";

const { Pool } = pg;

export type IndexType = "ivfflat" | "hnsw";

export interface IVFFlatParams {
  /** Number of IVFFlat lists. Defaults to 100. */
  lists?: number;
}

export interface HNSWParams {
  /** HNSW M parameter (connections per layer). Defaults to 16. */
  m?: number;
  /** HNSW ef_construction parameter. Defaults to 64. */
  efConstruction?: number;
}

export interface PostgresVectorStoreOptions {
  connectionString: string;
  /** Table name. Defaults to "documents". */
  table?: string;
  /** Vector dimensions — must match your embedder. Defaults to 1536. */
  dimensions?: number;
  /** Enable SSL. Defaults to false. */
  ssl?: boolean;
  /** Index algorithm. Defaults to "ivfflat". */
  indexType?: IndexType;
  /** Index-specific parameters. */
  indexParams?: IVFFlatParams | HNSWParams;
}

export class PostgresVectorStore implements VectorStore {
  readonly name = "postgres";

  private readonly table: string;
  private readonly dimensions: number;
  private readonly connectionString: string;
  private readonly ssl: boolean;
  private readonly indexType: IndexType;
  private readonly indexParams: IVFFlatParams | HNSWParams;
  private _pool: InstanceType<typeof Pool> | null = null;

  constructor(options: PostgresVectorStoreOptions) {
    if (!options.connectionString) {
      throw new Error("PostgresVectorStore: connectionString is required");
    }
    this.connectionString = options.connectionString;
    this.table = options.table ?? "documents";
    this.dimensions = options.dimensions ?? 1536;
    this.ssl = options.ssl ?? false;
    this.indexType = options.indexType ?? "ivfflat";
    this.indexParams = options.indexParams ?? {};
  }

  private get pool(): InstanceType<typeof Pool> {
    if (!this._pool) {
      this._pool = new Pool({
        connectionString: this.connectionString,
        ssl: this.ssl ? { rejectUnauthorized: false } : false,
      });
    }
    return this._pool;
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await pgvector.registerTypes(client);
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.table} (
          id SERIAL PRIMARY KEY,
          content TEXT NOT NULL,
          embedding vector(${this.dimensions}),
          metadata JSONB,
          source_file TEXT NOT NULL,
          commit_hash TEXT NOT NULL
        )
      `);
      await client.query(this.buildIndexSQL());
    } finally {
      client.release();
    }
  }

  async upsert(
    docs: Array<{
      content: string;
      embedding: number[];
      metadata: Record<string, unknown>;
      sourceFile: string;
      commitHash: string;
    }>,
  ): Promise<void> {
    if (docs.length === 0) return;

    const client = await this.pool.connect();
    try {
      await pgvector.registerTypes(client);
      for (const doc of docs) {
        await client.query(
          `INSERT INTO ${this.table} (content, embedding, metadata, source_file, commit_hash)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            doc.content,
            pgvector.toSql(doc.embedding),
            JSON.stringify(doc.metadata),
            doc.sourceFile,
            doc.commitHash,
          ],
        );
      }
    } finally {
      client.release();
    }
  }

  async deleteBySourceFile(files: string[]): Promise<void> {
    if (files.length === 0) return;
    await this.pool.query(
      `DELETE FROM ${this.table} WHERE source_file = ANY($1)`,
      [files],
    );
  }

  async getCurrentState(): Promise<Map<string, string>> {
    const { rows } = await this.pool.query<{
      source_file: string;
      commit_hash: string;
    }>(`SELECT source_file, commit_hash FROM ${this.table}`);
    return new Map(rows.map((r) => [r.source_file, r.commit_hash]));
  }

  private buildIndexSQL(): string {
    const idxName = `${this.table}_embedding_idx`;
    if (this.indexType === "hnsw") {
      const p = this.indexParams as HNSWParams;
      const m = p.m ?? 16;
      const efConstruction = p.efConstruction ?? 64;
      return (
        `CREATE INDEX IF NOT EXISTS ${idxName} ` +
        `ON ${this.table} USING hnsw (embedding vector_cosine_ops) ` +
        `WITH (m = ${m}, ef_construction = ${efConstruction})`
      );
    }
    const p = this.indexParams as IVFFlatParams;
    const lists = p.lists ?? 100;
    return (
      `CREATE INDEX IF NOT EXISTS ${idxName} ` +
      `ON ${this.table} USING ivfflat (embedding vector_cosine_ops) ` +
      `WITH (lists = ${lists})`
    );
  }

  async search(
    embedding: number[],
    topK: number,
  ): Promise<VectorSearchResult[]> {
    const client = await this.pool.connect();
    try {
      await pgvector.registerTypes(client);
      const { rows } = await client.query<{
        id: number;
        content: string;
        metadata: Record<string, unknown>;
        source_file: string;
        similarity: number;
      }>(
        `SELECT id, content, metadata, source_file,
                1 - (embedding <=> $1) AS similarity
         FROM ${this.table}
         ORDER BY embedding <=> $1
         LIMIT $2`,
        [pgvector.toSql(embedding), topK],
      );
      return rows.map((r) => ({
        id: String(r.id),
        content: r.content,
        metadata: r.metadata,
        sourceFile: r.source_file,
        similarity: r.similarity,
      }));
    } finally {
      client.release();
    }
  }

  async getIndexStats(): Promise<IndexStats> {
    return getIndexStats(this.pool, this.table);
  }

  async getQueryPerfReport(timeframeHours: number): Promise<QueryPerfReport> {
    return getQueryPerfReport(this.pool, this.table, timeframeHours);
  }
}

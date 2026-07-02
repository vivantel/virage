import type {
  VectorStore,
  VectorSearchResult,
  SearchOptions,
  IndexStats,
  QueryPerfReport,
  Logger,
} from "@vivantel/virage-core";
import { rrfMerge } from "@vivantel/virage-core";
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
  private logger: Logger | null = null;

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

  setLogger(logger: Logger): void {
    this.logger = logger.withTag("postgres");
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
    this.logger?.info(
      `Connecting to postgres, table: ${this.table} (${this.dimensions}d, ${this.indexType})`,
    );
    const client = await this.pool.connect();
    try {
      await pgvector.registerTypes(client);
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      // Old-schema detection: 'content' or 'context_text' columns indicate an outdated schema; drop and re-index.
      const { rows: cols } = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = $1 AND column_name IN ('content', 'context_text')`,
        [this.table],
      );
      if (cols.length > 0) {
        await client.query(`DROP TABLE IF EXISTS ${this.table}`);
        this.logger?.warn(
          `Postgres schema changed: table dropped, re-index required.`,
        );
      }
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.table} (
          id SERIAL PRIMARY KEY,
          dense_text TEXT NOT NULL,
          sparse_text TEXT NOT NULL,
          sparse_text_generator_id TEXT NOT NULL DEFAULT '',
          metadata_generator_id TEXT NOT NULL DEFAULT '',
          dense_text_hash TEXT NOT NULL,
          dense_vector vector(${this.dimensions}),
          metadata JSONB,
          source_file TEXT NOT NULL,
          commit_hash TEXT NOT NULL,
          ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // FTS column for hybrid search — generated on sparse_text, always up-to-date
      await client.query(`
        ALTER TABLE ${this.table}
        ADD COLUMN IF NOT EXISTS sparse_text_tsv tsvector
          GENERATED ALWAYS AS (to_tsvector('english', sparse_text)) STORED
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS ${this.table}_tsv_idx
        ON ${this.table} USING gin(sparse_text_tsv)
      `);
      await client.query(this.buildIndexSQL());
      this.logger?.debug(
        `Index type: ${this.indexType}, params: ${JSON.stringify(this.indexParams)}`,
      );
    } finally {
      client.release();
    }
  }

  async upsert(
    docs: import("@vivantel/virage-core").VectorDocument[],
  ): Promise<void> {
    if (docs.length === 0) return;

    this.logger?.verbose(`Upserting ${docs.length} docs into ${this.table}`);

    const client = await this.pool.connect();
    try {
      await pgvector.registerTypes(client);
      for (const doc of docs) {
        this.logger?.trace(`  source_file: ${doc.sourceFile}`);
        await client.query(
          `INSERT INTO ${this.table}
             (dense_text, sparse_text, sparse_text_generator_id, metadata_generator_id, dense_text_hash, dense_vector, metadata, source_file, commit_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT DO NOTHING`,
          [
            doc.denseText,
            doc.sparseText,
            doc.sparseTextGeneratorId,
            doc.metadataGeneratorId,
            doc.denseTextHash,
            pgvector.toSql(doc.denseVector),
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
    this.logger?.verbose(`Deleting docs for ${files.length} source file(s)`);
    await this.pool.query(
      `DELETE FROM ${this.table} WHERE source_file = ANY($1)`,
      [files],
    );
  }

  async existingHashes(hashes: string[]): Promise<string[]> {
    if (hashes.length === 0) return [];
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM ${this.table} WHERE id = ANY($1::text[])`,
      [hashes],
    );
    return rows.map((r) => r.id);
  }

  async getCurrentState(): Promise<Map<string, string>> {
    const { rows } = await this.pool.query<{
      source_file: string;
      commit_hash: string;
    }>(`SELECT source_file, commit_hash FROM ${this.table}`);
    const state = new Map<string, string>(
      rows.map((r) => [r.source_file, r.commit_hash]),
    );
    this.logger?.verbose(`getCurrentState: ${state.size} source version(s)`);
    return state;
  }

  private buildIndexSQL(): string {
    const idxName = `${this.table}_dense_vector_idx`;
    if (this.indexType === "hnsw") {
      const p = this.indexParams as HNSWParams;
      const m = p.m ?? 16;
      const efConstruction = p.efConstruction ?? 64;
      return (
        `CREATE INDEX IF NOT EXISTS ${idxName} ` +
        `ON ${this.table} USING hnsw (dense_vector vector_cosine_ops) ` +
        `WITH (m = ${m}, ef_construction = ${efConstruction})`
      );
    }
    const p = this.indexParams as IVFFlatParams;
    const lists = p.lists ?? 100;
    return (
      `CREATE INDEX IF NOT EXISTS ${idxName} ` +
      `ON ${this.table} USING ivfflat (dense_vector vector_cosine_ops) ` +
      `WITH (lists = ${lists})`
    );
  }

  async search(
    embedding: number[],
    topK: number,
    _collection?: string,
    options?: SearchOptions,
  ): Promise<VectorSearchResult[]> {
    const alpha = options?.alpha ?? 0.85;
    const beta = options?.beta ?? 0.15;
    const useHybrid = options?.hybrid === true && options.queryText;
    const labelFilter = options?.labelFilter;
    this.logger?.debug(
      `Search: topK=${topK}, alpha=${alpha}, beta=${beta}, hybrid=${useHybrid ?? false} labelFilter=${JSON.stringify(labelFilter ?? null)}`,
    );

    const applyLabelFilter = (
      results: VectorSearchResult[],
    ): VectorSearchResult[] => {
      if (!labelFilter || labelFilter.length === 0) return results;
      return results.filter((r) => {
        const chunkLabels = r.metadata["labels"] as string[] | undefined;
        return chunkLabels && labelFilter.some((l) => chunkLabels.includes(l));
      });
    };
    const client = await this.pool.connect();
    try {
      await pgvector.registerTypes(client);
      const fetchLimit = topK * 2;

      const runVectorQuery = async () => {
        const { rows } = await client.query<{
          id: number;
          dense_text: string;
          sparse_text: string;
          metadata: Record<string, unknown>;
          source_file: string;
          similarity: number;
          ingested_at: Date | null;
        }>(
          `SELECT id, dense_text, sparse_text, metadata, source_file,
                  1 - (dense_vector <=> $1) AS similarity,
                  ingested_at
           FROM ${this.table}
           ORDER BY dense_vector <=> $1
           LIMIT $2`,
          [pgvector.toSql(embedding), fetchLimit],
        );
        const now = Date.now();
        return rows.map((r) => {
          const ingestedAt = r.ingested_at ?? null;
          const recencyScore = ingestedAt
            ? Math.exp(
                -(now - ingestedAt.getTime()) / (1000 * 60 * 60 * 24 * 30),
              )
            : 0;
          return {
            id: String(r.id),
            denseText: r.dense_text,
            sparseText: r.sparse_text,
            metadata: r.metadata,
            sourceFile: r.source_file,
            similarity: r.similarity,
            ingestedAt: ingestedAt ?? undefined,
            _composite: r.similarity * alpha + recencyScore * beta,
          };
        });
      };

      if (!useHybrid) {
        const rows = await runVectorQuery();
        return applyLabelFilter(
          rows
            .sort((a, b) => b._composite - a._composite)
            .slice(0, topK)
            .map(({ _composite: _, ...rest }) => rest),
        );
      }

      const runFtsQuery = async (): Promise<VectorSearchResult[]> => {
        try {
          const { rows } = await client.query<{
            id: number;
            dense_text: string;
            sparse_text: string;
            metadata: Record<string, unknown>;
            source_file: string;
            fts_score: number;
          }>(
            `SELECT id, dense_text, sparse_text, metadata, source_file,
                    ts_rank_cd(sparse_text_tsv, query) AS fts_score
             FROM ${this.table}, plainto_tsquery('english', $1) query
             WHERE sparse_text_tsv @@ query
             ORDER BY fts_score DESC
             LIMIT $2`,
            [options!.queryText!, fetchLimit],
          );
          return rows.map((r) => ({
            id: String(r.id),
            denseText: r.dense_text,
            sparseText: r.sparse_text,
            metadata: r.metadata,
            sourceFile: r.source_file,
            similarity: r.fts_score,
          }));
        } catch {
          return [];
        }
      };

      const [vectorRaw, ftsResults] = await Promise.all([
        runVectorQuery(),
        runFtsQuery(),
      ]);
      const vectorResults: VectorSearchResult[] = vectorRaw
        .sort((a, b) => b._composite - a._composite)
        .map(({ _composite: _, ...rest }) => rest);

      return applyLabelFilter(
        rrfMerge(vectorResults, ftsResults, topK, options?.hybridAlpha ?? 0.6),
      );
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

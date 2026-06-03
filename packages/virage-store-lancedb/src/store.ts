import type {
  VectorDocument,
  VectorSearchResult,
  VectorStore,
  IndexStats,
  QueryPerfReport,
  Logger,
} from "@vivantel/virage-core";
import { Field, FixedSizeList, Float32, Schema, Utf8 } from "apache-arrow";
import { getIndexStats } from "./stats.js";
import { getQueryPerfReport } from "./query-perf.js";

export interface LanceDBVectorStoreOptions {
  uri: string;
  apiKey?: string;
  tableName?: string;
  dimensions?: number;
}

const DEFAULT_TABLE = "documents";
const DEFAULT_DIMENSIONS = 1536;

export class LanceDBVectorStore implements VectorStore {
  readonly name = "lancedb";

  private readonly uri: string;
  private readonly apiKey: string | undefined;
  private readonly tableName: string;
  private readonly dimensions: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private table: any;
  private logger: Logger | null = null;

  constructor(options: LanceDBVectorStoreOptions) {
    if (!options.uri) {
      throw new Error("LanceDBVectorStore: uri is required");
    }
    this.uri = options.uri;
    this.apiKey = options.apiKey;
    this.tableName = options.tableName ?? DEFAULT_TABLE;
    this.dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
  }

  setLogger(logger: Logger): void {
    this.logger = logger.withTag("lancedb");
  }

  async initialize(): Promise<void> {
    this.logger?.info(
      `Connecting to lancedb at ${this.uri}, table: ${this.tableName}`,
    );
    // Dynamic import to avoid native-module issues at load time
    const lancedb = await import("@lancedb/lancedb");

    this.db = this.apiKey
      ? await lancedb.connect(this.uri, { apiKey: this.apiKey })
      : await lancedb.connect(this.uri);

    const schema = new Schema([
      new Field("id", new Utf8()),
      new Field("content", new Utf8()),
      new Field(
        "embedding",
        new FixedSizeList(this.dimensions, new Field("item", new Float32())),
      ),
      new Field("metadata_json", new Utf8()),
      new Field("source_file", new Utf8()),
      new Field("commit_hash", new Utf8()),
      new Field("content_hash", new Utf8()),
    ]);

    this.table = await this.db.createEmptyTable(this.tableName, schema, {
      existOk: true,
    });
    this.logger?.debug(`Table "${this.tableName}" ready (${this.dimensions}d)`);
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    this.logger?.verbose(
      `Upserting ${documents.length} docs into "${this.tableName}"`,
    );
    const rows = documents.map((doc) => ({
      id: doc.id ?? crypto.randomUUID(),
      content: doc.content,
      embedding: doc.embedding,
      metadata_json: JSON.stringify(doc.metadata),
      source_file: doc.sourceFile,
      commit_hash: doc.commitHash,
      content_hash: doc.contentHash,
    }));

    this.logger?.trace(
      `  Row IDs: ${rows.map((r) => r.id.slice(0, 8)).join(", ")}`,
    );

    await this.table
      .mergeInsert("id")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(rows);
  }

  async deleteBySourceFile(sourceFiles: string[]): Promise<void> {
    if (sourceFiles.length === 0) return;
    this.logger?.verbose(
      `Deleting docs for ${sourceFiles.length} source file(s)`,
    );
    const escaped = sourceFiles.map((f) => f.replace(/'/g, "''"));
    const list = escaped.map((f) => `'${f}'`).join(", ");
    await this.table.delete(`source_file IN (${list})`);
  }

  async getCurrentState(): Promise<Map<string, string>> {
    const rows = await this.table
      .query()
      .select(["source_file", "commit_hash"])
      .toArray();

    const state = new Map<string, string>();
    for (const row of rows as Record<string, unknown>[]) {
      const sourceFile =
        typeof row.source_file === "string" ? row.source_file : null;
      const commitHash =
        typeof row.commit_hash === "string" ? row.commit_hash : null;
      if (sourceFile && commitHash) {
        state.set(sourceFile, commitHash);
      }
    }
    this.logger?.verbose(`getCurrentState: ${state.size} source version(s)`);
    return state;
  }

  async getIndexStats(): Promise<IndexStats> {
    return getIndexStats(this.table);
  }

  async getQueryPerfReport(timeframeHours: number): Promise<QueryPerfReport> {
    return getQueryPerfReport(this.table, this.dimensions, timeframeHours);
  }

  async search(
    queryEmbedding: number[],
    topK: number,
  ): Promise<VectorSearchResult[]> {
    this.logger?.debug(`Search: topK=${topK}`);
    const rows = await this.table
      .vectorSearch(queryEmbedding)
      .column("embedding")
      .distanceType("cosine")
      .limit(topK)
      .toArray();

    return (rows as Record<string, unknown>[]).map((row) => {
      const distance = typeof row._distance === "number" ? row._distance : 1;
      return {
        id: typeof row.id === "string" ? row.id : "",
        content: typeof row.content === "string" ? row.content : "",
        metadata: (() => {
          try {
            const parsed: unknown =
              typeof row.metadata_json === "string"
                ? JSON.parse(row.metadata_json)
                : {};
            return parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : {};
          } catch {
            return {};
          }
        })(),
        similarity: 1 - distance,
      };
    });
  }
}

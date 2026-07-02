import type {
  VectorDocument,
  VectorSearchResult,
  ListedDocument,
  VectorStore,
  VectorStoreMeta,
  SearchOptions,
  IndexStats,
  QueryPerfReport,
  Logger,
} from "@vivantel/virage-core";
import { rrfMerge } from "@vivantel/virage-core";
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private metaTable: any;
  private logger: Logger | null = null;
  private ftsIndexCreated = false;

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
    // For local (non-cloud) URIs, ensure the parent directory exists before
    // lancedb tries to create the database — lancedb creates the DB dir itself
    // but not intermediate parent directories.
    if (!this.uri.startsWith("db://") && !this.uri.startsWith("https://")) {
      const { mkdir } = await import("fs/promises");
      const { dirname } = await import("path");
      await mkdir(dirname(this.uri), { recursive: true });
    }
    // Dynamic import to avoid native-module issues at load time
    const lancedb = await import("@lancedb/lancedb");

    this.db = this.apiKey
      ? await lancedb.connect(this.uri, { apiKey: this.apiKey })
      : await lancedb.connect(this.uri);

    const schema = new Schema([
      new Field("id", new Utf8()),
      new Field("dense_text", new Utf8()),
      new Field("sparse_text", new Utf8()),
      new Field("dense_text_hash", new Utf8()),
      new Field("sparse_text_generator_id", new Utf8()),
      new Field("metadata_generator_id", new Utf8()),
      new Field(
        "dense_vector",
        new FixedSizeList(this.dimensions, new Field("item", new Float32())),
      ),
      new Field("metadata_json", new Utf8()),
      new Field("source_file", new Utf8()),
      new Field("commit_hash", new Utf8()),
    ]);

    const tableNames: string[] = await this.db.tableNames();
    const metaTableName = `${this.tableName}_meta`;

    if (tableNames.includes(this.tableName)) {
      const existing = await this.db.openTable(this.tableName);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingSchema = await (existing as any).schema();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fields = (existingSchema as any).fields as Array<{
        name: string;
        type: { listSize?: number };
      }>;
      const expectedNames = new Set(
        schema.fields.map((f: { name: string }) => f.name),
      );
      const existingNames = new Set(fields?.map((f) => f.name) ?? []);
      const columnMismatch =
        expectedNames.size !== existingNames.size ||
        [...expectedNames].some((n) => !existingNames.has(n));
      const vecField = fields?.find((f) => f.name === "dense_vector");
      const existingDims: number | undefined = (
        vecField?.type as { listSize?: number }
      )?.listSize;
      const dimMismatch =
        existingDims !== undefined && existingDims !== this.dimensions;
      if (columnMismatch || dimMismatch) {
        const reason = columnMismatch
          ? `column set changed (expected [${[...expectedNames].sort().join(", ")}], got [${[...existingNames].sort().join(", ")}])`
          : `dimension mismatch (${existingDims}→${this.dimensions})`;
        this.logger?.warn(
          `LanceDB schema changed (${reason}): dropping table, re-index required.`,
        );
        await this.db.dropTable(this.tableName);
        if (tableNames.includes(metaTableName)) {
          await this.db.dropTable(metaTableName);
        }
        this.table = await this.db.createEmptyTable(this.tableName, schema);
      } else {
        this.table = existing;
      }
    } else {
      this.table = await this.db.createEmptyTable(this.tableName, schema);
    }
    this.logger?.debug(`Table "${this.tableName}" ready (${this.dimensions}d)`);

    // Create FTS index for hybrid search.
    // When opening a pre-built archive the index already exists and createIndex
    // throws — probe listIndices() to detect that case so ftsIndexCreated is set
    // correctly even when the store is initialised from a downloaded archive.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.table as any).createIndex("sparse_text", {
        config: lancedb.Index.fts(),
      });
      this.ftsIndexCreated = true;
      this.logger?.debug("FTS index created on 'sparse_text'");
    } catch {
      // createIndex throws when the index already exists; check the index list
      // to distinguish "already there" from a genuine failure.
      try {
        const indices: Array<{ name?: string; indexType?: string }> =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (this.table as any).listIndices();
        this.ftsIndexCreated = indices.some(
          (i) =>
            i.indexType?.toUpperCase() === "FTS" ||
            i.name?.toLowerCase().includes("sparse_text"),
        );
      } catch {
        this.ftsIndexCreated = false;
      }
      this.logger?.debug(
        this.ftsIndexCreated
          ? "FTS index already exists on 'sparse_text'"
          : "FTS index not available",
      );
    }

    const metaSchema = new Schema([
      new Field("key", new Utf8()),
      new Field("value", new Utf8()),
    ]);
    const currentTableNames: string[] = await this.db.tableNames();
    if (currentTableNames.includes(metaTableName)) {
      this.metaTable = await this.db.openTable(metaTableName);
    } else {
      this.metaTable = await this.db.createEmptyTable(
        metaTableName,
        metaSchema,
      );
    }
  }

  async close(): Promise<void> {
    this.db = undefined;
    this.table = undefined;
    this.metaTable = undefined;
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    this.logger?.verbose(
      `Upserting ${documents.length} docs into "${this.tableName}"`,
    );
    const rows = documents.map((doc) => ({
      id: doc.id ?? doc.denseTextHash,
      dense_text: doc.denseText,
      sparse_text: doc.sparseText,
      dense_text_hash: doc.denseTextHash,
      sparse_text_generator_id: doc.sparseTextGeneratorId,
      metadata_generator_id: doc.metadataGeneratorId,
      dense_vector: doc.denseVector,
      metadata_json: JSON.stringify(doc.metadata),
      source_file: doc.sourceFile,
      commit_hash: doc.commitHash,
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

  async existingHashes(hashes: string[]): Promise<string[]> {
    if (hashes.length === 0) return [];
    const escaped = hashes.map((h) => h.replace(/'/g, "''"));
    const list = escaped.map((h) => `'${h}'`).join(", ");
    const rows = (await this.table
      .query()
      .select(["id"])
      .where(`id IN (${list})`)
      .toArray()) as Record<string, unknown>[];
    return rows.map((r) => r.id as string);
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

  async getStats(): Promise<{ documentCount: number; collections: string[] }> {
    const documentCount = (await this.table.countRows()) as number;
    return { documentCount, collections: [] };
  }

  async getIndexStats(): Promise<IndexStats> {
    return getIndexStats(this.table);
  }

  async getQueryPerfReport(timeframeHours: number): Promise<QueryPerfReport> {
    return getQueryPerfReport(this.table, this.dimensions, timeframeHours);
  }

  async listAll(opts?: {
    limit?: number;
    offset?: number;
    includeVectors?: boolean;
  }): Promise<ListedDocument[]> {
    const columns = [
      "id",
      "dense_text",
      "sparse_text",
      "dense_text_hash",
      "sparse_text_generator_id",
      "metadata_generator_id",
      "metadata_json",
      "source_file",
      "commit_hash",
      ...(opts?.includeVectors ? ["dense_vector"] : []),
    ];
    let query = this.table.query().select(columns);
    if (opts?.offset) query = query.offset(opts.offset);
    if (opts?.limit) query = query.limit(opts.limit);
    const rows = (await query.toArray()) as Record<string, unknown>[];

    return rows.map((row) => {
      const metadata = (() => {
        try {
          const parsed: unknown =
            typeof row.metadata_json === "string"
              ? JSON.parse(row.metadata_json)
              : {};
          return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
        } catch {
          return {};
        }
      })();
      const doc: ListedDocument = {
        id: typeof row.id === "string" ? row.id : "",
        denseText: typeof row.dense_text === "string" ? row.dense_text : "",
        sparseText: typeof row.sparse_text === "string" ? row.sparse_text : "",
        denseTextHash:
          typeof row.dense_text_hash === "string" ? row.dense_text_hash : "",
        sparseTextGeneratorId:
          typeof row.sparse_text_generator_id === "string"
            ? row.sparse_text_generator_id
            : "",
        metadataGeneratorId:
          typeof row.metadata_generator_id === "string"
            ? row.metadata_generator_id
            : "",
        metadata,
        sourceFile: typeof row.source_file === "string" ? row.source_file : "",
        commitHash: typeof row.commit_hash === "string" ? row.commit_hash : "",
      };
      if (opts?.includeVectors && Array.isArray(row.dense_vector)) {
        doc.denseVector = row.dense_vector as number[];
      }
      return doc;
    });
  }

  private rowToResult(row: Record<string, unknown>): VectorSearchResult {
    const distance = typeof row._distance === "number" ? row._distance : 1;
    const metadata = (() => {
      try {
        const parsed: unknown =
          typeof row.metadata_json === "string"
            ? JSON.parse(row.metadata_json)
            : {};
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    })();
    return {
      id: typeof row.id === "string" ? row.id : "",
      denseText: typeof row.dense_text === "string" ? row.dense_text : "",
      sparseText: typeof row.sparse_text === "string" ? row.sparse_text : "",
      metadata,
      similarity: 1 - distance,
      sourceFile:
        typeof row.source_file === "string" ? row.source_file : undefined,
      sparseTextGeneratorId:
        typeof row.sparse_text_generator_id === "string"
          ? row.sparse_text_generator_id
          : undefined,
      metadataGeneratorId:
        typeof row.metadata_generator_id === "string"
          ? row.metadata_generator_id
          : undefined,
    };
  }

  private rowsToResults(rows: unknown[]): VectorSearchResult[] {
    return (rows as Record<string, unknown>[]).map((row) =>
      this.rowToResult(row),
    );
  }

  private async vectorSearchInternal(
    queryEmbedding: number[],
    fetchLimit: number,
  ): Promise<VectorSearchResult[]> {
    try {
      const rows = await this.table
        .vectorSearch(queryEmbedding)
        .column("dense_vector")
        .distanceType("cosine")
        .limit(fetchLimit)
        .toArray();
      return this.rowsToResults(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("query dim") ||
        msg.includes("doesn't match the column embedding vector dim")
      ) {
        throw new Error(
          `Embedder mismatch: the stored index was built with a different embedding model (query is ${queryEmbedding.length}d but index vectors are larger). ` +
            `Run "virage index --force" to rebuild the index with the current embedder.`,
          { cause: err },
        );
      }
      throw err;
    }
  }

  private async ftsSearchInternal(
    queryText: string,
    fetchLimit: number,
  ): Promise<VectorSearchResult[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (this.table as any)
        .search(queryText, "fts")
        .limit(fetchLimit)
        .toArray();
      return (rows as Record<string, unknown>[]).map((row) => ({
        ...this.rowToResult(row),
        similarity: typeof row._score === "number" ? row._score : 0,
      }));
    } catch {
      return [];
    }
  }

  async search(
    queryEmbedding: number[],
    topK: number,
    _collection?: string,
    options?: SearchOptions,
  ): Promise<VectorSearchResult[]> {
    const filter = options?.filter;
    const useHybrid =
      options?.hybrid === true && this.ftsIndexCreated && options.queryText;

    const labelFilter = options?.labelFilter;

    /** Post-retrieval predicate that checks both metadata filter and label filter. */
    const postFilter = (r: VectorSearchResult): boolean => {
      if (
        filter &&
        !Object.entries(filter).every(([k, v]) => r.metadata[k] === v)
      ) {
        return false;
      }
      if (labelFilter && labelFilter.length > 0) {
        const chunkLabels = r.metadata["labels"] as string[] | undefined;
        if (!chunkLabels || !labelFilter.some((l) => chunkLabels.includes(l))) {
          return false;
        }
      }
      return true;
    };

    const needsPostFilter =
      !!filter || (!!labelFilter && labelFilter.length > 0);

    if (useHybrid) {
      const fetchLimit = topK * 2;
      this.logger?.debug(
        `Hybrid search: topK=${topK} labelFilter=${JSON.stringify(labelFilter ?? null)}`,
      );
      const [vectorResults, ftsResults] = await Promise.all([
        this.vectorSearchInternal(queryEmbedding, fetchLimit),
        this.ftsSearchInternal(options!.queryText!, fetchLimit),
      ]);
      let merged = rrfMerge(
        vectorResults,
        ftsResults,
        topK,
        options?.hybridAlpha ?? 0.6,
      );
      if (needsPostFilter) {
        merged = merged.filter(postFilter);
      }
      return merged.slice(0, topK);
    }

    // Pure vector search path
    const fetchLimit = needsPostFilter ? topK * 4 : topK;
    this.logger?.debug(
      `Search: topK=${topK} fetchLimit=${fetchLimit} filter=${JSON.stringify(filter ?? null)} labelFilter=${JSON.stringify(labelFilter ?? null)}`,
    );
    const results = await this.vectorSearchInternal(queryEmbedding, fetchLimit);

    if (!needsPostFilter) return results;

    return results.filter(postFilter).slice(0, topK);
  }

  async readMeta(): Promise<VectorStoreMeta | null> {
    if (!this.metaTable) return null;
    try {
      const rows = await this.metaTable
        .query()
        .where(`key = 'meta'`)
        .limit(1)
        .toArray();
      if (rows.length) {
        const value = (rows[0] as Record<string, unknown>).value;
        if (typeof value === "string") {
          return JSON.parse(value) as VectorStoreMeta;
        }
      }
    } catch {
      /* ignore */
    }
    // Fall back to reading dimensions from the table schema so that old indexes
    // (written before writeMeta was introduced) are still detected as mismatched.
    if (this.table) {
      try {
        // schema() is an async method in LanceDB 0.18+; must be called and awaited
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tableSchema = await (this.table as any).schema();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fields = (tableSchema as any)?.fields as
          Array<{ name: string; type: { listSize?: number } }> | undefined;
        const embField = fields?.find((f) => f.name === "dense_vector");
        const schemaDims = embField?.type?.listSize;
        if (typeof schemaDims === "number") {
          return {
            providerName: "unknown",
            dimensions: schemaDims,
            createdAt: 0,
          };
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  async writeMeta(meta: VectorStoreMeta): Promise<void> {
    if (!this.metaTable) return;
    await this.metaTable.delete(`key = 'meta'`);
    await this.metaTable.add([{ key: "meta", value: JSON.stringify(meta) }]);
  }
}

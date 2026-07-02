import type {
  VectorStore,
  VectorDocument,
  VectorSearchResult,
  SearchOptions,
  IndexStats,
  QueryPerfReport,
  Logger,
} from "@vivantel/virage-core";
import { rrfMerge } from "@vivantel/virage-core";
import { QdrantClient } from "@qdrant/js-client-rest";
import { getIndexStats } from "./stats.js";
import { getQueryPerfReport } from "./query-perf.js";

export interface QdrantVectorStoreOptions {
  /**
   * Qdrant instance URL. e.g. "http://localhost:6333" or "https://xyz.qdrant.io".
   * Required unless `path` is provided.
   */
  url?: string;
  /**
   * Local storage directory for Qdrant data (file mode).
   * When provided, connects to `http://localhost:<port>` — you must start Qdrant
   * pointing at this directory, e.g.:
   *   docker run -v <path>:/qdrant/storage -p 6333:6333 qdrant/qdrant
   * Mutually exclusive with `url`.
   */
  path?: string;
  /** Port used when `path` mode is active. Defaults to 6333. */
  port?: number;
  /** API key — required for Qdrant Cloud, omit for local instances. */
  apiKey?: string;
  /** Collection name. Defaults to "documents". */
  collection?: string;
  /** Vector dimensions — must match your embedder. Defaults to 1536. */
  dimensions?: number;
}

const UPSERT_BATCH_SIZE = 100;
const SCROLL_PAGE_SIZE = 250;

export class QdrantVectorStore implements VectorStore {
  readonly name = "qdrant";

  private readonly client: QdrantClient;
  private readonly collection: string;
  private readonly dimensions: number;
  private readonly url: string;
  private logger: Logger | null = null;

  constructor(options: QdrantVectorStoreOptions) {
    if (!options.url && !options.path) {
      throw new Error("QdrantVectorStore: either url or path is required");
    }
    const resolvedUrl =
      options.url ?? `http://localhost:${options.port ?? 6333}`;
    this.url = resolvedUrl;
    this.collection = options.collection ?? "documents";
    this.dimensions = options.dimensions ?? 1536;
    this.client = new QdrantClient({
      url: resolvedUrl,
      apiKey: options.apiKey,
    });
  }

  setLogger(logger: Logger): void {
    this.logger = logger.withTag("qdrant");
  }

  async initialize(): Promise<void> {
    this.logger?.info(
      `Connecting to qdrant at ${this.url}, collection: ${this.collection}`,
    );
    const { exists } = await this.client.collectionExists(this.collection);
    if (!exists) {
      await this.client.createCollection(this.collection, {
        vectors: { size: this.dimensions, distance: "Cosine" },
      });
      this.logger?.debug(
        `Created collection "${this.collection}" (${this.dimensions}d, cosine)`,
      );
    } else {
      this.logger?.debug(`Collection "${this.collection}" already exists`);
    }
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    this.logger?.verbose(
      `Upserting ${documents.length} docs into "${this.collection}"`,
    );
    for (let i = 0; i < documents.length; i += UPSERT_BATCH_SIZE) {
      const batch = documents.slice(i, i + UPSERT_BATCH_SIZE);
      const points = batch.map((doc) => ({
        id: doc.id ?? doc.denseTextHash,
        vector: doc.denseVector,
        payload: {
          dense_text: doc.denseText,
          sparse_text: doc.sparseText,
          dense_text_hash: doc.denseTextHash,
          sparse_text_generator_id: doc.sparseTextGeneratorId,
          metadata_generator_id: doc.metadataGeneratorId,
          metadata: doc.metadata,
          source_file: doc.sourceFile,
          commit_hash: doc.commitHash,
        },
      }));
      await this.client.upsert(this.collection, {
        wait: true,
        points,
      });
      this.logger?.trace(
        `  Upserted IDs: ${points.map((p) => String(p.id).slice(0, 8)).join(", ")}`,
      );
    }
  }

  async deleteBySourceFile(sourceFiles: string[]): Promise<void> {
    if (sourceFiles.length === 0) return;
    this.logger?.verbose(
      `Deleting docs for ${sourceFiles.length} source file(s)`,
    );
    await this.client.delete(this.collection, {
      wait: true,
      filter: {
        must: [{ key: "source_file", match: { any: sourceFiles } }],
      },
    });
  }

  async existingHashes(hashes: string[]): Promise<string[]> {
    if (hashes.length === 0) return [];
    const points = await this.client.retrieve(this.collection, {
      ids: hashes,
      with_vector: false,
      with_payload: false,
    });
    return points.map((p) => String(p.id));
  }

  async deleteOrphanedChunks(
    sourceFile: string,
    keepHashes: string[],
  ): Promise<void> {
    if (keepHashes.length === 0) {
      await this.deleteBySourceFile([sourceFile]);
      return;
    }
    await this.client.delete(this.collection, {
      wait: true,
      filter: {
        must: [{ key: "source_file", match: { value: sourceFile } }],
        must_not: [{ has_id: keepHashes }],
      },
    });
  }

  async getCurrentState(): Promise<Map<string, string>> {
    const state = new Map<string, string>();
    let offset: string | number | undefined;

    do {
      const response = await this.client.scroll(this.collection, {
        with_payload: ["source_file", "commit_hash"],
        with_vector: false,
        limit: SCROLL_PAGE_SIZE,
        offset,
      });

      for (const point of response.points) {
        const payload = point.payload as
          Record<string, unknown> | null | undefined;
        const sourceFile =
          typeof payload?.source_file === "string" ? payload.source_file : null;
        const commitHash =
          typeof payload?.commit_hash === "string" ? payload.commit_hash : null;
        if (sourceFile && commitHash) {
          state.set(sourceFile, commitHash);
        }
      }

      const raw = response.next_page_offset;
      // ExtendedPointId (string | number) means more pages; anything else stops iteration
      offset =
        typeof raw === "string" || typeof raw === "number" ? raw : undefined;
    } while (offset !== undefined);

    this.logger?.verbose(`getCurrentState: ${state.size} source version(s)`);
    return state;
  }

  private payloadToResult(r: {
    id: string | number;
    score: number;
    payload?: Record<string, unknown> | null;
  }): VectorSearchResult {
    const payload = r.payload as Record<string, unknown> | null | undefined;
    return {
      id: String(r.id),
      denseText:
        typeof payload?.dense_text === "string" ? payload.dense_text : "",
      sparseText:
        typeof payload?.sparse_text === "string" ? payload.sparse_text : "",
      metadata:
        payload?.metadata &&
        typeof payload.metadata === "object" &&
        !Array.isArray(payload.metadata)
          ? (payload.metadata as Record<string, unknown>)
          : {},
      similarity: r.score,
    };
  }

  async search(
    queryEmbedding: number[],
    topK: number,
    _collection?: string,
    options?: SearchOptions,
  ): Promise<VectorSearchResult[]> {
    const useHybrid = options?.hybrid === true && options.queryText;
    const labelFilter = options?.labelFilter;
    this.logger?.debug(
      `Search: topK=${topK} hybrid=${useHybrid ?? false} labelFilter=${JSON.stringify(labelFilter ?? null)}`,
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

    if (useHybrid) {
      const fetchLimit = topK * 2;
      const queryText = options!.queryText!;

      const [vectorResults, textResults] = await Promise.all([
        this.client.search(this.collection, {
          vector: queryEmbedding,
          limit: fetchLimit,
          with_payload: true,
        }),
        this.client.scroll(this.collection, {
          filter: {
            must: [{ key: "sparse_text", match: { text: queryText } }],
          },
          with_payload: true,
          with_vector: false,
          limit: fetchLimit,
        }),
      ]);

      const vectorMapped = vectorResults.map((r) => this.payloadToResult(r));
      const textMapped = textResults.points.map((p, i) =>
        this.payloadToResult({
          id: p.id,
          score: 1 / (i + 1),
          payload: p.payload as Record<string, unknown> | null,
        }),
      );

      const merged = rrfMerge(
        vectorMapped,
        textMapped,
        topK,
        options?.hybridAlpha ?? 0.6,
      );
      return applyLabelFilter(merged).slice(0, topK);
    }

    const fetchLimit = labelFilter && labelFilter.length > 0 ? topK * 4 : topK;
    const results = await this.client.search(this.collection, {
      vector: queryEmbedding,
      limit: fetchLimit,
      with_payload: true,
    });

    return applyLabelFilter(results.map((r) => this.payloadToResult(r))).slice(
      0,
      topK,
    );
  }

  async getIndexStats(): Promise<IndexStats> {
    return getIndexStats(this.client, this.collection);
  }

  async getQueryPerfReport(timeframeHours: number): Promise<QueryPerfReport> {
    return getQueryPerfReport(this.url, this.collection, timeframeHours);
  }
}

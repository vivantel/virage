import type {
  VectorStore,
  VectorDocument,
  VectorSearchResult,
  IndexStats,
  QueryPerfReport,
  Logger,
} from "@vivantel/virage-core";
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
        id: crypto.randomUUID(),
        vector: doc.embedding,
        payload: {
          content: doc.content,
          metadata: doc.metadata,
          source_file: doc.sourceFile,
          commit_hash: doc.commitHash,
          content_hash: doc.contentHash,
        },
      }));
      await this.client.upsert(this.collection, {
        wait: true,
        points,
      });
      this.logger?.trace(
        `  Upserted IDs: ${points.map((p) => p.id.slice(0, 8)).join(", ")}`,
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
          | Record<string, unknown>
          | null
          | undefined;
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

  async search(
    queryEmbedding: number[],
    topK: number,
  ): Promise<VectorSearchResult[]> {
    this.logger?.debug(`Search: topK=${topK}`);
    const results = await this.client.search(this.collection, {
      vector: queryEmbedding,
      limit: topK,
      with_payload: true,
    });

    return results.map((r) => {
      const payload = r.payload as Record<string, unknown> | null | undefined;
      return {
        id: String(r.id),
        content: typeof payload?.content === "string" ? payload.content : "",
        metadata:
          payload?.metadata &&
          typeof payload.metadata === "object" &&
          !Array.isArray(payload.metadata)
            ? (payload.metadata as Record<string, unknown>)
            : {},
        similarity: r.score,
      };
    });
  }

  async getIndexStats(): Promise<IndexStats> {
    return getIndexStats(this.client, this.collection);
  }

  async getQueryPerfReport(timeframeHours: number): Promise<QueryPerfReport> {
    return getQueryPerfReport(this.url, this.collection, timeframeHours);
  }
}

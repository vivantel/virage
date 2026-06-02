import type {
  VectorStore,
  VectorDocument,
  VectorSearchResult,
  IndexStats,
  QueryPerfReport,
} from "@vivantel/rag-core";
import { QdrantClient } from "@qdrant/js-client-rest";
import { getIndexStats } from "./stats.js";
import { getQueryPerfReport } from "./query-perf.js";

export interface QdrantVectorStoreOptions {
  /** Qdrant instance URL. e.g. "http://localhost:6333" or "https://xyz.qdrant.io" */
  url: string;
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

  constructor(options: QdrantVectorStoreOptions) {
    if (!options.url) {
      throw new Error("QdrantVectorStore: url is required");
    }
    this.url = options.url;
    this.collection = options.collection ?? "documents";
    this.dimensions = options.dimensions ?? 1536;
    this.client = new QdrantClient({
      url: options.url,
      apiKey: options.apiKey,
    });
  }

  async initialize(): Promise<void> {
    const { exists } = await this.client.collectionExists(this.collection);
    if (!exists) {
      await this.client.createCollection(this.collection, {
        vectors: { size: this.dimensions, distance: "Cosine" },
      });
    }
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    for (let i = 0; i < documents.length; i += UPSERT_BATCH_SIZE) {
      const batch = documents.slice(i, i + UPSERT_BATCH_SIZE);
      await this.client.upsert(this.collection, {
        wait: true,
        points: batch.map((doc) => ({
          id: crypto.randomUUID(),
          vector: doc.embedding,
          payload: {
            content: doc.content,
            metadata: doc.metadata,
            source_file: doc.sourceFile,
            commit_hash: doc.commitHash,
            content_hash: doc.contentHash,
          },
        })),
      });
    }
  }

  async deleteBySourceFile(sourceFiles: string[]): Promise<void> {
    if (sourceFiles.length === 0) return;
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
          typeof payload?.source_file === "string"
            ? payload.source_file
            : null;
        const commitHash =
          typeof payload?.commit_hash === "string"
            ? payload.commit_hash
            : null;
        if (sourceFile && commitHash) {
          state.set(sourceFile, commitHash);
        }
      }

      const raw = response.next_page_offset;
      // ExtendedPointId (string | number) means more pages; anything else stops iteration
      offset =
        typeof raw === "string" || typeof raw === "number" ? raw : undefined;
    } while (offset !== undefined);

    return state;
  }

  async search(
    queryEmbedding: number[],
    topK: number,
  ): Promise<VectorSearchResult[]> {
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

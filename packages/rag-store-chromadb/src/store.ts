import type {
  VectorDocument,
  VectorSearchResult,
  VectorStore,
  IndexStats,
  QueryPerfReport,
} from "@vivantel/rag-core";
import { ChromaClient, type Collection } from "chromadb";
import { getIndexStats } from "./stats.js";
import { getQueryPerfReport } from "./query-perf.js";

export interface ChromaVectorStoreOptions {
  path?: string;
  collectionName?: string;
  dimensions?: number;
  apiKey?: string;
}

const DEFAULT_COLLECTION = "documents";
const DEFAULT_DIMENSIONS = 1536;
const UPSERT_BATCH_SIZE = 100;
const SCROLL_PAGE_SIZE = 1000;

export class ChromaVectorStore implements VectorStore {
  readonly name = "chromadb";

  private readonly path: string;
  private readonly collectionName: string;
  private readonly dimensions: number;
  private readonly apiKey: string | undefined;
  private client!: ChromaClient;
  private collection!: Collection;

  constructor(options: ChromaVectorStoreOptions) {
    this.path = options.path ?? "http://localhost:8000";
    this.collectionName = options.collectionName ?? DEFAULT_COLLECTION;
    this.dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
    this.apiKey = options.apiKey;
  }

  async initialize(): Promise<void> {
    this.client = new ChromaClient({
      path: this.path,
      auth: this.apiKey
        ? { provider: "token", credentials: this.apiKey }
        : undefined,
    });

    this.collection = await this.client.getOrCreateCollection({
      name: this.collectionName,
      metadata: { "hnsw:space": "cosine" },
    });
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    for (let i = 0; i < documents.length; i += UPSERT_BATCH_SIZE) {
      const batch = documents.slice(i, i + UPSERT_BATCH_SIZE);
      await this.collection.upsert({
        ids: batch.map((doc) => doc.id ?? crypto.randomUUID()),
        embeddings: batch.map((doc) => doc.embedding),
        documents: batch.map((doc) => doc.content),
        metadatas: batch.map((doc) => ({
          source_file: doc.sourceFile,
          commit_hash: doc.commitHash,
          content_hash: doc.contentHash,
          ...doc.metadata,
        })),
      });
    }
  }

  async deleteBySourceFile(sourceFiles: string[]): Promise<void> {
    if (sourceFiles.length === 0) return;
    await this.collection.delete({
      where: { source_file: { $in: sourceFiles } },
    });
  }

  async getCurrentState(): Promise<Map<string, string>> {
    const state = new Map<string, string>();
    let offset = 0;

    while (true) {
      const result = await this.collection.get({
        include: ["metadatas"] as ["metadatas"],
        limit: SCROLL_PAGE_SIZE,
        offset,
      });

      for (const meta of result.metadatas) {
        if (!meta) continue;
        const sourceFile =
          typeof meta.source_file === "string" ? meta.source_file : null;
        const commitHash =
          typeof meta.commit_hash === "string" ? meta.commit_hash : null;
        if (sourceFile && commitHash) {
          state.set(sourceFile, commitHash);
        }
      }

      if (result.ids.length < SCROLL_PAGE_SIZE) break;
      offset += SCROLL_PAGE_SIZE;
    }

    return state;
  }

  async getIndexStats(): Promise<IndexStats> {
    return getIndexStats(this.collection);
  }

  async getQueryPerfReport(timeframeHours: number): Promise<QueryPerfReport> {
    return getQueryPerfReport(this.collection, this.dimensions, timeframeHours);
  }

  async search(
    queryEmbedding: number[],
    topK: number,
  ): Promise<VectorSearchResult[]> {
    const result = await this.collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      include: ["documents", "metadatas", "distances"] as [
        "documents",
        "metadatas",
        "distances",
      ],
    });

    const ids = result.ids[0] ?? [];
    const documents = result.documents[0] ?? [];
    const metadatas = result.metadatas[0] ?? [];
    const distances = result.distances?.[0] ?? [];

    return ids.map((id, i) => ({
      id,
      content: documents[i] ?? "",
      metadata: (() => {
        const meta = metadatas[i];
        if (!meta || typeof meta !== "object") return {};
        const { source_file, commit_hash, content_hash, ...rest } =
          meta as Record<string, unknown>;
        void source_file;
        void commit_hash;
        void content_hash;
        return rest;
      })(),
      similarity: 1 - (distances[i] ?? 1),
    }));
  }
}

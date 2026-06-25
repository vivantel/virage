import type {
  VectorDocument,
  VectorSearchResult,
  VectorStore,
  SearchOptions,
  IndexStats,
  QueryPerfReport,
  Logger,
} from "@vivantel/virage-core";
import { rrfMerge } from "@vivantel/virage-core";
import { ChromaClient, IncludeEnum, type Collection } from "chromadb";
import MiniSearch from "minisearch";
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
  private logger: Logger | null = null;
  private miniSearch: MiniSearch | null = null;
  private miniSearchStale = true;

  constructor(options: ChromaVectorStoreOptions) {
    this.path = options.path ?? "http://localhost:8000";
    this.collectionName = options.collectionName ?? DEFAULT_COLLECTION;
    this.dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
    this.apiKey = options.apiKey;
  }

  setLogger(logger: Logger): void {
    this.logger = logger.withTag("chromadb");
  }

  async initialize(): Promise<void> {
    this.logger?.info(
      `Connecting to chromadb at ${this.path}, collection: ${this.collectionName}`,
    );
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
    this.logger?.debug(
      `Collection "${this.collectionName}" ready (cosine, ${this.dimensions}d)`,
    );
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    this.miniSearchStale = true;
    this.logger?.verbose(
      `Upserting ${documents.length} docs into "${this.collectionName}"`,
    );
    for (let i = 0; i < documents.length; i += UPSERT_BATCH_SIZE) {
      const batch = documents.slice(i, i + UPSERT_BATCH_SIZE);
      const ids = batch.map((doc) => doc.id ?? doc.denseTextHash);
      await this.collection.upsert({
        ids,
        embeddings: batch.map((doc) => doc.denseVector),
        documents: batch.map((doc) => doc.denseText),
        metadatas: batch.map((doc) => ({
          source_file: doc.sourceFile,
          commit_hash: doc.commitHash,
          dense_text_hash: doc.denseTextHash,
          sparse_text: doc.sparseText,
          context_text: doc.contextText,
          ...doc.metadata,
        })),
      });
      this.logger?.trace(
        `  Upserted IDs: ${ids.map((id) => id.slice(0, 8)).join(", ")}`,
      );
    }
  }

  async deleteBySourceFile(sourceFiles: string[]): Promise<void> {
    if (sourceFiles.length === 0) return;
    this.miniSearchStale = true;
    this.logger?.verbose(
      `Deleting docs for ${sourceFiles.length} source file(s)`,
    );
    await this.collection.delete({
      where: { source_file: { $in: sourceFiles } },
    });
  }

  async getCurrentState(): Promise<Map<string, string>> {
    const state = new Map<string, string>();
    let offset = 0;

    while (true) {
      const result = await this.collection.get({
        include: [IncludeEnum.metadatas],
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

    this.logger?.verbose(`getCurrentState: ${state.size} source version(s)`);
    return state;
  }

  async getIndexStats(): Promise<IndexStats> {
    return getIndexStats(this.collection);
  }

  async getQueryPerfReport(timeframeHours: number): Promise<QueryPerfReport> {
    return getQueryPerfReport(this.collection, this.dimensions, timeframeHours);
  }

  private async buildMiniSearchIfStale(): Promise<void> {
    if (!this.miniSearchStale) return;
    const ms = new MiniSearch<{ id: string; sparse_text: string }>({
      fields: ["sparse_text"],
      storeFields: ["id", "sparse_text"],
    });
    let offset = 0;
    while (true) {
      const result = await this.collection.get({
        include: [IncludeEnum.metadatas],
        limit: SCROLL_PAGE_SIZE,
        offset,
      });
      const docs = result.ids.map((id, i) => ({
        id,
        sparse_text:
          typeof result.metadatas[i]?.sparse_text === "string"
            ? (result.metadatas[i]!.sparse_text as string)
            : "",
      }));
      if (docs.length > 0) ms.addAll(docs);
      if (result.ids.length < SCROLL_PAGE_SIZE) break;
      offset += SCROLL_PAGE_SIZE;
    }
    this.miniSearch = ms;
    this.miniSearchStale = false;
  }

  private async vectorSearchInternal(
    queryEmbedding: number[],
    nResults: number,
  ): Promise<VectorSearchResult[]> {
    const result = await this.collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults,
      include: [
        IncludeEnum.documents,
        IncludeEnum.metadatas,
        IncludeEnum.distances,
      ],
    });
    const ids = result.ids[0] ?? [];
    const documents = result.documents[0] ?? [];
    const metadatas = result.metadatas[0] ?? [];
    const distances = result.distances?.[0] ?? [];
    return ids.map((id, i) => ({
      id,
      denseText: documents[i] ?? "",
      sparseText: (() => {
        const meta = metadatas[i];
        return typeof meta?.sparse_text === "string" ? meta.sparse_text : "";
      })(),
      contextText: (() => {
        const meta = metadatas[i];
        return typeof meta?.context_text === "string" ? meta.context_text : "";
      })(),
      metadata: (() => {
        const meta = metadatas[i];
        if (!meta || typeof meta !== "object") return {};
        const {
          source_file,
          commit_hash,
          dense_text_hash,
          sparse_text,
          context_text,
          ...rest
        } = meta as Record<string, unknown>;
        void source_file;
        void commit_hash;
        void dense_text_hash;
        void sparse_text;
        void context_text;
        return rest;
      })(),
      similarity: 1 - (distances[i] ?? 1),
    }));
  }

  async search(
    queryEmbedding: number[],
    topK: number,
    _collection?: string,
    options?: SearchOptions,
  ): Promise<VectorSearchResult[]> {
    const useHybrid = options?.hybrid === true && options.queryText;
    this.logger?.debug(`Search: topK=${topK} hybrid=${useHybrid ?? false}`);

    if (useHybrid) {
      await this.buildMiniSearchIfStale();
      const [vectorResults, miniRaw] = await Promise.all([
        this.vectorSearchInternal(queryEmbedding, topK * 2),
        Promise.resolve(
          this.miniSearch!.search(options!.queryText!, {
            prefix: true,
            fuzzy: 0.2,
          }),
        ),
      ]);
      const maxScore = miniRaw[0]?.score ?? 1;
      const bm25Results: VectorSearchResult[] = miniRaw
        .slice(0, topK * 2)
        .map((r) => ({
          id: r.id as string,
          denseText: "",
          sparseText: r.sparse_text as string,
          contextText: "",
          metadata: {},
          similarity: r.score / maxScore,
        }));
      return rrfMerge(
        vectorResults,
        bm25Results,
        topK,
        options?.hybridAlpha ?? 0.6,
      );
    }

    return this.vectorSearchInternal(queryEmbedding, topK);
  }
}

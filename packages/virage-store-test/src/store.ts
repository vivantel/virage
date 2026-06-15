import type {
  VectorDocument,
  VectorSearchResult,
  VectorStore,
  SearchOptions,
  IndexStats,
  QueryPerfReport,
  Logger,
} from "@vivantel/virage-core";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface FileVectorStoreOptions {
  path: string;
}

interface StoredDoc {
  id: string;
  content: string;
  sourceFile: string;
  commitHash: string;
  contentHash: string;
}

export class FileVectorStore implements VectorStore {
  readonly name = "file-test-store";

  private readonly filePath: string;
  private data: StoredDoc[] = [];
  private logger: Logger | null = null;

  constructor(options: FileVectorStoreOptions) {
    if (!options.path) throw new Error("FileVectorStore: path is required");
    this.filePath = options.path;
  }

  setLogger(logger: Logger): void {
    this.logger = logger.withTag("test-store");
  }

  async initialize(): Promise<void> {
    mkdirSync(dirname(this.filePath), { recursive: true });
    if (existsSync(this.filePath)) {
      this.data = JSON.parse(
        readFileSync(this.filePath, "utf8"),
      ) as StoredDoc[];
    }
    this.logger?.info(
      `FileVectorStore ready at ${this.filePath} (${this.data.length} docs)`,
    );
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    for (const doc of documents) {
      const id = doc.id ?? crypto.randomUUID();
      const row: StoredDoc = {
        id,
        content: doc.content,
        sourceFile: doc.sourceFile,
        commitHash: doc.commitHash,
        contentHash: doc.contentHash,
      };
      const idx = this.data.findIndex((d) => d.id === id);
      if (idx >= 0) this.data[idx] = row;
      else this.data.push(row);
    }
    this._persist();
    this.logger?.info(
      `Upserted ${documents.length} docs (total: ${this.data.length})`,
    );
  }

  async deleteBySourceFile(sourceFiles: string[]): Promise<void> {
    const before = this.data.length;
    this.data = this.data.filter((d) => !sourceFiles.includes(d.sourceFile));
    this._persist();
    this.logger?.info(
      `Deleted ${before - this.data.length} docs for ${sourceFiles.length} file(s)`,
    );
  }

  async getCurrentState(): Promise<Map<string, string>> {
    const state = new Map<string, string>();
    for (const row of this.data) {
      if (row.sourceFile && row.commitHash)
        state.set(row.sourceFile, row.commitHash);
    }
    return state;
  }

  async search(
    _queryEmbedding: number[],
    topK: number,
    _collection?: string,
    _options?: SearchOptions,
  ): Promise<VectorSearchResult[]> {
    return this.data.slice(0, topK).map((d) => ({
      id: d.id,
      content: d.content,
      metadata: {},
      similarity: 1,
    }));
  }

  async getIndexStats(): Promise<IndexStats> {
    return {
      totalVectors: this.data.length,
      indexType: "flat",
      annRecallAt10: -1,
      indexAgeHours: -1,
      deadTupleFraction: 0,
      suggestions: ["File-backed test store — no real index."],
    };
  }

  async getQueryPerfReport(timeframeHours: number): Promise<QueryPerfReport> {
    return {
      timeframeHours,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      slowQueryCount: 0,
      suggestedIndexes: [],
    };
  }

  private _persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}

export function createVectorStore(
  config: Record<string, unknown>,
): VectorStore {
  return new FileVectorStore(config as unknown as FileVectorStoreOptions);
}

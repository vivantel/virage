/**
 * Advanced RAG config showing all available options.
 */
import {
  RAGPipelineConfig,
  EmbeddingProvider,
  VectorStore,
  VectorSearchResult,
  createChunker,
  markdownHeadersStrategy,
  tokenStrategy,
  semanticStrategy,
  wholeFileStrategy,
} from "@vivantel/rag-core";

// Stubbed providers — replace with real implementations
const embedder: EmbeddingProvider = {
  name: "my-provider",
  dimensions: 1536,
  async embed(text: string): Promise<number[]> {
    void text;
    throw new Error("Not implemented");
  },
  async embedBatch(texts: string[]): Promise<number[][]> {
    void texts;
    throw new Error("Not implemented");
  },
  async healthCheck(): Promise<boolean> {
    return true;
  },
};

const vectorStore: VectorStore = {
  name: "my-store",
  async initialize() {},
  async upsert(_docs) {},
  async deleteBySourceFile(_files) {},
  async getCurrentState() {
    return new Map();
  },
  async search(_embedding, _topK): Promise<VectorSearchResult[]> {
    return [];
  },
};

const config: RAGPipelineConfig = {
  chunkers: [
    // Different .md directories can use different strategies
    createChunker({ patterns: ["docs/**/*.md"], strategy: markdownHeadersStrategy() }),
    createChunker({ patterns: ["rules/**/*.md"], strategy: wholeFileStrategy() }),
    createChunker({ patterns: ["blog/**/*.md"], strategy: semanticStrategy() }),
    createChunker({
      patterns: ["src/**/*.ts", "src/**/*.tsx"],
      strategy: tokenStrategy({ maxTokens: 400, overlap: 40 }),
    }),
  ],
  embedder,
  vectorStore,
  options: {
    // File paths for intermediate state (committed to git for incremental updates)
    chunksFile: "./docs/rag/chunks.json",
    embeddingsFile: "./docs/rag/embeddings.json",

    // Milliseconds to wait between individual embed() calls (avoids rate limits)
    rateLimitMs: 200,

    // Use provider.embedBatch() when chunk count exceeds this threshold
    batchSize: 20,

    // Skip uploading to the vector store (useful for CI that only re-chunks)
    // skipUpload: true,

    // Re-process everything even if commit hashes haven't changed
    // force: true,

    // Show what would change without actually uploading
    // dryRun: true,
  },
};

export default config;

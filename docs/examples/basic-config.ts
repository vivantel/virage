/**
 * Minimal RAG config example.
 * Copy to rag.config.ts and fill in the TODO sections.
 */
import {
  RAGPipelineConfig,
  EmbeddingProvider,
  VectorStore,
  VectorSearchResult,
  createChunker,
  markdownHeadersStrategy,
  tokenStrategy,
} from "@vivantel/rag-core";

// Replace with your embedding provider (e.g. OpenAI, GitHub Models)
const embedder: EmbeddingProvider = {
  name: "my-provider",
  dimensions: 1536,
  async embed(text: string): Promise<number[]> {
    void text;
    throw new Error("Not implemented — replace with a real provider");
  },
};

// Replace with your vector store (e.g. @vivantel/rag-store-supabase)
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
    createChunker({
      name: "docs",
      patterns: ["docs/**/*.md"],
      process: async (content) => markdownHeadersStrategy()(content),
    }),
    createChunker({
      name: "source",
      patterns: ["src/**/*.ts"],
      process: async (content) => tokenStrategy()(content),
    }),
  ],
  embedder,
  vectorStore,
};

export default config;

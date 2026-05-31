import type { RAGPipelineConfig, EmbeddingProvider, VectorStore, VectorSearchResult } from '@vivantel/rag-core';
import { createChunker, markdownHeadersStrategy, tokenStrategy, wholeFileStrategy } from '@vivantel/rag-core';

// Requires GITHUB_TOKEN in your environment (.env or CI secret)

const embedder: EmbeddingProvider = {
  name: 'github-models',
  dimensions: 1536, // text-embedding-3-small
  async embed(text: string): Promise<number[]> {
    const res = await fetch('https://models.github.ai/inference/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      },
      body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: text }),
    });
    if (!res.ok) throw new Error(`GitHub Models error: ${res.statusText}`);
    const json = await res.json() as { data: Array<{ embedding: number[] }> };
    return json.data[0].embedding;
  },
};

// Install: npm install @vivantel/rag-store-supabase @supabase/supabase-js
// import { SupabaseVectorStore } from '@vivantel/rag-store-supabase';
// const vectorStore = new SupabaseVectorStore({
//   url: process.env.SUPABASE_URL!,
//   key: process.env.SUPABASE_KEY!,
//   table: 'documents',
// });

const vectorStore: VectorStore = {
  name: 'supabase',
  async initialize() {
    throw new Error('Configure your Supabase vector store — uncomment the lines above');
  },
  async upsert(_docs) { throw new Error('Not implemented'); },
  async deleteBySourceFile(_files) { throw new Error('Not implemented'); },
  async getCurrentState() { return new Map(); },
  async search(_embedding, _topK) { return []; },
};

const config: RAGPipelineConfig = {
  chunkers: [
    createChunker({ patterns: ["**/*.md","**/*.mdx"], strategy: markdownHeadersStrategy() }),
    createChunker({ patterns: ["**/*.ts","**/*.tsx"], strategy: tokenStrategy() }),
    createChunker({ patterns: ["**/*.js","**/*.jsx"], strategy: tokenStrategy() }),
    createChunker({ patterns: ["**/*.yaml","**/*.yml"], strategy: wholeFileStrategy() }),
  ],
  embedder,
  vectorStore,
  options: {
    chunksFile: './docs/rag/chunks.json',
    embeddingsFile: './docs/rag/embeddings.json',
  },
};

export default config;

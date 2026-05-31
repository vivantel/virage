import type { RAGPipelineConfig, EmbeddingProvider, VectorStore, VectorSearchResult } from '@vivantel/rag-core';
import { createChunker, markdownHeadersStrategy, tokenStrategy, wholeFileStrategy } from '@vivantel/rag-core';

// Install: npm install openai
// import OpenAI from 'openai';
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const embedder: EmbeddingProvider = {
  name: 'openai',
  dimensions: 1536, // text-embedding-3-small
  async embed(text: string): Promise<number[]> {
    // const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text });
    // return res.data[0].embedding;
    throw new Error('Configure your OpenAI embedder — uncomment and adapt the lines above');
  },
  async embedBatch(texts: string[]): Promise<number[][]> {
    // const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: texts });
    // return res.data.map(d => d.embedding);
    throw new Error('Configure your OpenAI embedder — uncomment and adapt the lines above');
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

import type { RAGPipelineConfig, VectorStore, VectorSearchResult } from './dist/index.js';
import { GitHubModelsEmbedder, createChunker, markdownHeadersStrategy, tokenStrategy, wholeFileStrategy } from './dist/index.js';
import { createClient } from '@supabase/supabase-js';

const embedder = new GitHubModelsEmbedder({ token: process.env.MODELS_TOKEN! });

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_KEY env vars are required');
    _supabase = createClient(url, key);
  }
  return _supabase;
}

const vectorStore: VectorStore = {
  name: 'supabase',
  async initialize() {},
  async upsert(docs) {
    await getSupabase().from('documents').upsert(
      docs.map((d) => ({
        content: d.content,
        embedding: d.embedding,
        metadata: d.metadata,
        source_file: d.sourceFile,
        commit_hash: d.commitHash,
      })),
    );
  },
  async deleteBySourceFile(files) {
    await getSupabase().from('documents').delete().in('source_file', files);
  },
  async getCurrentState() {
    const { data } = await getSupabase()
      .from('documents')
      .select('source_file, commit_hash');
    return new Map((data ?? []).map((r) => [r.source_file, r.commit_hash]));
  },
  async search(embedding, topK): Promise<VectorSearchResult[]> {
    const { data } = await getSupabase().rpc('match_documents', {
      query_embedding: embedding,
      match_count: topK,
    });
    return (data ?? []).map((r) => ({
      content: r.content,
      metadata: r.metadata,
      sourceFile: r.source_file,
      score: r.similarity,
    }));
  },
};

const config: RAGPipelineConfig = {
  chunkers: [
    createChunker({ patterns: ['**/*.md', '**/*.mdx'], strategy: markdownHeadersStrategy() }),
    createChunker({ patterns: ['src/**/*.ts', 'src/**/*.tsx'], strategy: tokenStrategy() }),
    createChunker({ patterns: ['**/*.yaml', '**/*.yml'], strategy: wholeFileStrategy() }),
  ],
  embedder,
  vectorStore,
  options: {
    chunksFile: './docs/rag/chunks.json',
    embeddingsFile: './docs/rag/embeddings.json',
    batchSize: 20,
    maxBatchChars: 100_000, // GitHub Models: 64K token limit ≈ 256K chars; 100K is a safe margin
  },
};

export default config;

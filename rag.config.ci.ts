import type { RAGPipelineConfig, EmbeddingProvider, VectorStore, VectorSearchResult } from './dist/index.js';
import { createChunker, markdownHeadersStrategy, tokenStrategy, wholeFileStrategy } from './dist/index.js';
import { createClient } from '@supabase/supabase-js';

async function ghEmbed(input: string | string[]): Promise<number[][]> {
  const res = await fetch('https://models.inference.ai.azure.com/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input }),
  });
  if (!res.ok) throw new Error(`GitHub Models error: ${res.statusText}`);
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

const embedder: EmbeddingProvider = {
  name: 'github-models',
  dimensions: 1536,
  async embed(text: string): Promise<number[]> {
    return (await ghEmbed(text))[0];
  },
  async embedBatch(texts: string[]): Promise<number[][]> {
    return ghEmbed(texts);
  },
};

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

const vectorStore: VectorStore = {
  name: 'supabase',
  async initialize() {},
  async upsert(docs) {
    await supabase.from('documents').upsert(
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
    await supabase.from('documents').delete().in('source_file', files);
  },
  async getCurrentState() {
    const { data } = await supabase
      .from('documents')
      .select('source_file, commit_hash');
    return new Map((data ?? []).map((r) => [r.source_file, r.commit_hash]));
  },
  async search(embedding, topK): Promise<VectorSearchResult[]> {
    const { data } = await supabase.rpc('match_documents', {
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
  },
};

export default config;

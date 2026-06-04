import type {
  EmbeddingsDb,
  EmbeddingProvider,
  VectorStore,
} from "@vivantel/virage-core";

export interface McpContext {
  db: EmbeddingsDb;
  embedder: EmbeddingProvider;
  vectorStore: VectorStore;
}

export async function handleSearch(
  args: { query: string; top_k?: number; collection?: string },
  ctx: McpContext,
) {
  const embedding = await ctx.embedder.embed(args.query);
  const results = await ctx.vectorStore.search(
    embedding,
    args.top_k ?? 5,
    args.collection,
  );
  return results.map((r) => ({
    id: r.id,
    content: r.content,
    metadata: r.metadata,
    similarity: r.similarity,
    sourceFile: (r.metadata["sourceFile"] as string | undefined) ?? r.id,
  }));
}

export async function handleListChunks(
  args: { source_file?: string; limit?: number },
  ctx: McpContext,
) {
  let chunks = ctx.db.getAllChunks();
  if (args.source_file) {
    chunks = chunks.filter((c) => c.sourceFile === args.source_file);
  }
  return chunks.slice(0, args.limit ?? 100).map((c) => ({
    contentHash: c.contentHash,
    sourceFile: c.sourceFile,
    content: c.content.slice(0, 200),
    metadata: c.metadata,
  }));
}

export async function handleGetChunk(
  args: { content_hash: string },
  ctx: McpContext,
) {
  const chunk = ctx.db
    .getAllChunks()
    .find((c) => c.contentHash === args.content_hash);
  if (!chunk) throw new Error(`Chunk not found: ${args.content_hash}`);
  return chunk;
}

export async function handleListSourceFiles(
  _args: Record<string, never>,
  ctx: McpContext,
) {
  const chunks = ctx.db.getAllChunks();
  const fileStates = ctx.db.getFileStates();

  const countMap = new Map<string, number>();
  for (const c of chunks) {
    countMap.set(c.sourceFile, (countMap.get(c.sourceFile) ?? 0) + 1);
  }

  return Array.from(countMap.entries()).map(([sourceFile, chunkCount]) => ({
    sourceFile,
    chunkCount,
    commitHash: fileStates.get(sourceFile) ?? null,
  }));
}

export async function handleGetStats(
  _args: Record<string, never>,
  ctx: McpContext,
) {
  const allChunks = ctx.db.getAllChunks();
  const embedded = ctx.db.getAll();
  const pendingEmbedCount = ctx.db.getPendingEmbedChunks().length;
  const pendingUploadCount = ctx.db.pendingCount();
  const uploadedCount =
    allChunks.length - pendingEmbedCount - pendingUploadCount;
  const meta = ctx.db.getMeta();

  return {
    totalChunks: allChunks.length,
    embeddedCount: embedded.length,
    uploadedCount: Math.max(0, uploadedCount),
    pendingEmbedCount,
    pendingUploadCount,
    lastUpdated: meta?.updatedAt ?? null,
  };
}

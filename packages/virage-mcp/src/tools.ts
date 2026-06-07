import { randomUUID } from "crypto";
import type {
  VirageDb,
  EmbeddingProvider,
  VectorStore,
  TelemetrySession,
  FeedbackPayload,
} from "@vivantel/virage-core";
import { normalizeMissingCategory } from "@vivantel/virage-core";

export interface McpContext {
  db: VirageDb;
  embedder: EmbeddingProvider;
  vectorStore: VectorStore;
  session?: TelemetrySession;
  lastSearchId?: string;
  feedbackArmed?: boolean;
}

export async function handleSearch(
  args: { query: string; top_k?: number; collection?: string },
  ctx: McpContext,
) {
  const searchId = randomUUID();
  const t0 = Date.now();

  const embedding = await ctx.embedder.embed(args.query);
  const embedMs = Date.now() - t0;

  const t1 = Date.now();
  const results = await ctx.vectorStore.search(
    embedding,
    args.top_k ?? 5,
    args.collection,
  );
  const searchMs = Date.now() - t1;
  const totalMs = Date.now() - t0;

  ctx.session?.recordLatency("embed", embedMs);
  ctx.session?.recordLatency("search", searchMs);
  ctx.session?.recordLatency("total", totalMs);
  ctx.session?.recordSearch(searchId, results.length, embedding);

  ctx.lastSearchId = searchId;
  ctx.feedbackArmed =
    ctx.session?.shouldSampleFeedback(results.length) ?? false;

  return results.map((r) => ({
    id: r.id,
    content: r.content,
    metadata: r.metadata,
    similarity: r.similarity,
    sourceFile: (r.metadata["sourceFile"] as string | undefined) ?? r.id,
  }));
}

export interface RagFeedbackArgs {
  search_query_id?: string;
  was_useful: boolean;
  metrics?: {
    context_relevance?: number;
    context_completeness?: number;
    noise_ratio?: number;
    missing_category?: string;
  };
}

export function handleRagFeedback(
  args: RagFeedbackArgs,
  ctx: McpContext,
): void {
  if (!ctx.session) return;
  const searchId = args.search_query_id ?? ctx.lastSearchId;
  if (!searchId) return;

  const payload: FeedbackPayload = {
    wasUseful: args.was_useful,
    contextRelevance: args.metrics?.context_relevance,
    contextCompleteness: args.metrics?.context_completeness,
    noiseRatio: args.metrics?.noise_ratio,
    missingCategory: normalizeMissingCategory(args.metrics?.missing_category),
  };
  ctx.session.recordFeedback(searchId, payload);
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

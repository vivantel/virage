import {
  EmbeddingProvider,
  EmbeddedChunk,
  EmbeddingsMeta,
  Chunk,
} from "../interfaces/index.js";
import { readFile } from "fs/promises";
import { createHash } from "crypto";
import { EmbedError } from "./errors.js";
import {
  sleep,
  withRetry,
  withConcurrency,
  batchBySize,
  RetryOptions,
} from "./utils.js";
import { readEmbeddingsFile, writeEmbeddingsFile } from "./embeddings-io.js";

function chunkContentHash(chunk: Chunk): string {
  if (chunk.contentHash) return chunk.contentHash;
  return createHash("sha256").update(chunk.content).digest("hex").slice(0, 16);
}

export class EmbedderProcessor {
  private provider: EmbeddingProvider;
  private rateLimitMs: number;
  private batchSize: number;
  private maxBatchChars: number;
  private retryOptions: RetryOptions;
  private concurrency: number;
  private vectorStoreName?: string;

  constructor(
    provider: EmbeddingProvider,
    options: {
      rateLimitMs?: number;
      batchSize?: number;
      maxBatchChars?: number;
      retry?: RetryOptions;
      concurrency?: number;
      vectorStoreName?: string;
    } = {},
  ) {
    this.provider = provider;
    this.rateLimitMs = options.rateLimitMs ?? 500;
    this.batchSize = options.batchSize ?? provider.preferredBatchSize ?? 10;
    this.maxBatchChars = options.maxBatchChars ?? Infinity;
    this.retryOptions = options.retry ?? {};
    this.concurrency = options.concurrency ?? 1;
    this.vectorStoreName = options.vectorStoreName;
  }

  async embedChunk(chunk: Chunk): Promise<EmbeddedChunk> {
    const embedding = await withRetry(
      () => this.provider.embed(chunk.content),
      this.retryOptions,
    );

    return {
      ...chunk,
      embedding,
      embeddedAt: Date.now() / 1000,
    };
  }

  async embedBatch(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    if (this.provider.embedBatch && chunks.length > 0) {
      const texts = chunks.map((c) => c.content);
      const embeddings = await withRetry(
        () => this.provider.embedBatch!(texts),
        this.retryOptions,
      );

      if (embeddings.length !== chunks.length) {
        throw new EmbedError(
          `embedBatch returned ${embeddings.length} embeddings for ${chunks.length} chunks`,
          {
            suggestion:
              "Check that your EmbeddingProvider.embedBatch() returns one vector per input text.",
          },
        );
      }

      return chunks.map((chunk, i) => ({
        ...chunk,
        embedding: embeddings[i],
        embeddedAt: Date.now() / 1000,
      }));
    }

    let completed = 0;
    const tasks = chunks.map((chunk) => async (): Promise<EmbeddedChunk> => {
      const label =
        (chunk.metadata.event_type as string) ||
        (chunk.metadata.title as string) ||
        chunk.sourceFile.split("/").pop() ||
        "unknown";

      const embedded = await this.embedChunk(chunk);
      completed++;
      console.log(`  [${completed}/${chunks.length}] ${label}`);

      if (this.rateLimitMs > 0) {
        await sleep(this.rateLimitMs);
      }

      return embedded;
    });

    return withConcurrency(tasks, this.concurrency);
  }

  async getChunksToEmbed(
    chunksFile: string,
    force: boolean = false,
  ): Promise<{
    chunksToEmbed: Chunk[];
    existingMeta: EmbeddingsMeta | null;
    isNewEmbeddingSpace: boolean;
  }> {
    let chunks: Chunk[];
    try {
      const content = await readFile(chunksFile, "utf-8");
      const parsed: unknown = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        throw new Error("chunks file does not contain a JSON array");
      }
      chunks = parsed as Chunk[];
    } catch (err) {
      throw new EmbedError(
        `Failed to load chunks from ${chunksFile}: ${err instanceof Error ? err.message : String(err)}`,
        {
          suggestion:
            "Run the pipeline without --skip-upload to regenerate chunks first.",
          cause: err,
        },
      );
    }

    console.log(`📖 Loaded ${chunks.length} chunks from ${chunksFile}`);

    if (force) {
      console.log("  ⚠️ Force mode: embedding all chunks");
      return {
        chunksToEmbed: chunks,
        existingMeta: null,
        isNewEmbeddingSpace: true,
      };
    }

    const embeddingsFile = chunksFile.replace("chunks", "embeddings");
    const { meta, chunks: existingEmbeddings } =
      await readEmbeddingsFile(embeddingsFile);

    // Check if the embedding model or dimensions changed — if so, all cached embeddings
    // are invalid for the new model's vector space.
    // Discriminators: model + dimensions. providerName is informational only (the same
    // model served via OpenAI, Azure, or GitHub Models produces identical vectors).
    const isNewEmbeddingSpace = false;
    if (meta && existingEmbeddings.length > 0) {
      const modelChanged =
        meta.model !== undefined &&
        this.provider.model !== undefined &&
        meta.model !== this.provider.model;
      const dimensionsChanged =
        meta.providerDimensions !== this.provider.dimensions;

      if (modelChanged || dimensionsChanged) {
        const prevModel = meta.model ?? "(unknown)";
        const curModel = this.provider.model ?? "(unknown)";
        const prevDims = meta.providerDimensions;
        const curDims = this.provider.dimensions;
        console.log(`\n⚠️  Embedding model changed!`);
        console.log(`    Previous: ${prevModel} (${prevDims}d)`);
        console.log(`    Current:  ${curModel} (${curDims}d)`);
        console.log(
          `    Discarding existing embeddings — all chunks will be re-embedded.\n`,
        );
        return {
          chunksToEmbed: chunks,
          existingMeta: null,
          isNewEmbeddingSpace: true,
        };
      }
    }

    // Two-level index:
    //   (sourceFile::commitHash) → Set<contentHash>  — for file-level fast path
    //   contentHash (global)                          — for per-chunk fallback
    const embeddedFileVersions = new Map<string, Set<string>>();
    const embeddedByContentHash = new Set<string>();
    for (const emb of existingEmbeddings) {
      const key = `${emb.sourceFile}::${emb.commitHash}`;
      const hash = emb.contentHash || chunkContentHash(emb);
      embeddedByContentHash.add(hash);
      const entry = embeddedFileVersions.get(key);
      if (entry) {
        entry.add(hash);
      } else {
        embeddedFileVersions.set(key, new Set([hash]));
      }
    }

    console.log(
      `📊 Existing embeddings: ${existingEmbeddings.length} chunks across ${embeddedFileVersions.size} file version(s)`,
    );

    // Group incoming chunks by (sourceFile, commitHash)
    const chunksByFileVersion = new Map<string, Chunk[]>();
    for (const chunk of chunks) {
      const key = `${chunk.sourceFile}::${chunk.commitHash}`;
      const group = chunksByFileVersion.get(key);
      if (group) {
        group.push(chunk);
      } else {
        chunksByFileVersion.set(key, [chunk]);
      }
    }

    const chunksToEmbed: Chunk[] = [];
    let skippedFiles = 0;
    let skippedChunks = 0;

    for (const [key, fileChunks] of chunksByFileVersion) {
      const fileVersionHashes = embeddedFileVersions.get(key);

      // Fast path: every chunk for this (sourceFile, commitHash) is already embedded
      if (
        fileVersionHashes &&
        fileVersionHashes.size === fileChunks.length &&
        fileChunks.every((c) => fileVersionHashes.has(chunkContentHash(c)))
      ) {
        skippedFiles++;
        skippedChunks += fileChunks.length;
        continue;
      }

      // Per-chunk fallback: check globally by contentHash (handles partial embeddings
      // from interrupted runs, or content-identical chunks at a different commit)
      for (const chunk of fileChunks) {
        if (!embeddedByContentHash.has(chunkContentHash(chunk))) {
          chunksToEmbed.push(chunk);
        }
      }
    }

    if (skippedFiles > 0) {
      console.log(
        `  ⏭️  Skipped ${skippedFiles} unchanged file version(s) (${skippedChunks} chunks)`,
      );
    }

    return { chunksToEmbed, existingMeta: meta, isNewEmbeddingSpace };
  }

  async saveEmbeddings(
    newEmbeddings: EmbeddedChunk[],
    chunksFile: string,
    existingMeta: EmbeddingsMeta | null,
    isFirstBatch: boolean,
    forceFirstBatch: boolean,
  ): Promise<void> {
    const embeddingsFile = chunksFile.replace("chunks", "embeddings");
    const now = Math.floor(Date.now() / 1000);

    const newByHash = new Map<string, EmbeddedChunk>();
    for (const emb of newEmbeddings) {
      const hash = emb.contentHash || chunkContentHash(emb);
      newByHash.set(hash, emb);
    }

    // When force-clearing (force flag or model mismatch detected), discard existing chunks
    // on the first batch; subsequent batches always merge incrementally.
    const discardExisting = isFirstBatch && forceFirstBatch;

    let keepChunks: EmbeddedChunk[] = [];
    let createdAt = now;
    if (!discardExisting) {
      const { meta, chunks: existing } =
        await readEmbeddingsFile(embeddingsFile);
      if (meta) createdAt = meta.createdAt;
      keepChunks = existing.filter((e) => {
        const hash = e.contentHash || chunkContentHash(e);
        return !newByHash.has(hash);
      });
    }

    const final = [...keepChunks, ...newEmbeddings];

    const meta: EmbeddingsMeta = {
      schemaVersion: 1,
      providerName: this.provider.name,
      providerDimensions: this.provider.dimensions,
      ...(this.provider.model !== undefined
        ? { model: this.provider.model }
        : {}),
      ...(this.vectorStoreName !== undefined
        ? { vectorStoreName: this.vectorStoreName }
        : {}),
      // Preserve createdAt from the existing meta when available and not overwriting
      createdAt:
        existingMeta && !discardExisting ? existingMeta.createdAt : createdAt,
      updatedAt: now,
    };

    await writeEmbeddingsFile(embeddingsFile, meta, final);
    console.log(`\n💾 Saved ${final.length} embeddings to ${embeddingsFile}`);
    console.log(
      `   New: ${newEmbeddings.length}, Existing: ${keepChunks.length}`,
    );
  }

  async run(
    chunksFile: string,
    force: boolean = false,
  ): Promise<EmbeddedChunk[]> {
    console.log("🔢 Starting incremental embedding generation...");

    const { chunksToEmbed, existingMeta, isNewEmbeddingSpace } =
      await this.getChunksToEmbed(chunksFile, force);

    // Treat a model-space change the same as --force for the save step
    const effectiveForce = force || isNewEmbeddingSpace;

    if (chunksToEmbed.length === 0) {
      console.log("\n✨ No chunks need embedding.");
      return [];
    }

    console.log(`\n📝 Need to embed ${chunksToEmbed.length} chunks`);

    const batches = batchBySize(
      chunksToEmbed,
      this.batchSize,
      (c) => c.content.length,
      this.maxBatchChars,
    );
    const newEmbeddings: EmbeddedChunk[] = [];

    for (let i = 0; i < batches.length; i++) {
      console.log(
        `\n🔢 Batch ${i + 1}/${batches.length} (${batches[i].length} chunks)`,
      );
      const embedded = await this.embedBatch(batches[i]);
      newEmbeddings.push(...embedded);
      await this.saveEmbeddings(
        embedded,
        chunksFile,
        existingMeta,
        i === 0,
        i === 0 && effectiveForce,
      );
    }

    return newEmbeddings;
  }
}

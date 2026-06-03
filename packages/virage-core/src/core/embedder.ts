import {
  EmbeddingProvider,
  EmbeddedChunk,
  EmbeddingsMeta,
  Chunk,
} from "../interfaces/index.js";
import type { Logger } from "../interfaces/logger.js";
import { NullLogger } from "../logger/null-logger.js";
import { readFile } from "fs/promises";
import { createHash } from "crypto";
import { EmbedError } from "./errors.js";
import {
  sleep,
  withRetry,
  withConcurrency,
  batchBySize,
  defaultIsRetryable,
  RetryOptions,
} from "./utils.js";
import { EmbeddingsDb } from "./embeddings-db.js";

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
  private saveIntervalMs: number;
  private minIngestionBatchSize: number;
  private logger: Logger;
  onProgress?: (completed: number, total: number) => void;

  constructor(
    provider: EmbeddingProvider,
    options: {
      rateLimitMs?: number;
      batchSize?: number;
      maxBatchChars?: number;
      retry?: RetryOptions;
      concurrency?: number;
      vectorStoreName?: string;
      saveIntervalMs?: number;
      minIngestionBatchSize?: number;
      logger?: Logger;
      onProgress?: (completed: number, total: number) => void;
    } = {},
  ) {
    this.provider = provider;
    this.rateLimitMs = options.rateLimitMs ?? 500;
    this.batchSize = options.batchSize ?? provider.preferredBatchSize ?? 10;
    this.maxBatchChars = options.maxBatchChars ?? Infinity;
    this.retryOptions = options.retry ?? {};
    this.concurrency = options.concurrency ?? 1;
    this.vectorStoreName = options.vectorStoreName;
    this.saveIntervalMs = options.saveIntervalMs ?? 30_000;
    this.minIngestionBatchSize = options.minIngestionBatchSize ?? Infinity;
    this.onProgress = options.onProgress;
    this.logger = (options.logger ?? new NullLogger()).withTag("embedder");
  }

  async embedChunk(chunk: Chunk): Promise<EmbeddedChunk> {
    const embedding = await withRetry(
      () => this.provider.embed(chunk.content),
      { ...this.retryOptions, isRetryable: defaultIsRetryable },
      this.logger,
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
        { ...this.retryOptions, isRetryable: defaultIsRetryable },
        this.logger,
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
      this.logger.verbose(`[${completed}/${chunks.length}] ${label}`);
      this.logger.trace(
        `  ${chunkContentHash(chunk)}: ${chunk.content.slice(0, 60).replace(/\n/g, " ")}`,
      );

      if (this.rateLimitMs > 0) {
        this.logger.trace(`Rate limit: sleeping ${this.rateLimitMs}ms`);
        await sleep(this.rateLimitMs);
      }

      return embedded;
    });

    return withConcurrency(tasks, this.concurrency);
  }

  async getChunksToEmbed(
    db: EmbeddingsDb,
    chunks: Chunk[],
    force: boolean = false,
  ): Promise<{
    chunksToEmbed: Chunk[];
    meta: EmbeddingsMeta | null;
    isNewEmbeddingSpace: boolean;
  }> {
    this.logger.info(`📖 Loaded ${chunks.length} chunks`);
    this.logger.debug(
      `Provider: ${this.provider.name}, model: ${this.provider.model ?? "(none)"}, dims: ${this.provider.dimensions}`,
    );

    const existingMeta = db.getMeta();

    if (force) {
      this.logger.verbose("Force mode: clearing db and embedding all chunks");
      db.clearAll();
      return { chunksToEmbed: chunks, meta: null, isNewEmbeddingSpace: true };
    }

    // Check if the embedding model or dimensions changed
    if (existingMeta) {
      const modelChanged =
        existingMeta.model !== undefined &&
        this.provider.model !== undefined &&
        existingMeta.model !== this.provider.model;
      const dimensionsChanged =
        existingMeta.providerDimensions !== this.provider.dimensions;

      if (modelChanged || dimensionsChanged) {
        const prevModel = existingMeta.model ?? "(unknown)";
        const curModel = this.provider.model ?? "(unknown)";
        const prevDims = existingMeta.providerDimensions;
        const curDims = this.provider.dimensions;
        this.logger.warn(`⚠️ Embedding model changed!`);
        this.logger.warn(`   Previous: ${prevModel} (${prevDims}d)`);
        this.logger.warn(`   Current:  ${curModel} (${curDims}d)`);
        this.logger.warn(
          `   Discarding existing embeddings — all chunks will be re-embedded.`,
        );
        db.clearAll();
        return { chunksToEmbed: chunks, meta: null, isNewEmbeddingSpace: true };
      }
    }

    // Two-level index: (sourceFile::commitHash) → Set<contentHash> and global contentHash set
    const existingEmbeddings = db.getAll();
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

    this.logger.verbose(
      `📊 Existing: ${existingEmbeddings.length} chunks across ${embeddedFileVersions.size} version(s)`,
    );
    this.logger.debug(`Vector store: ${this.vectorStoreName ?? "(none)"}`);

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

      if (
        fileVersionHashes &&
        fileVersionHashes.size === fileChunks.length &&
        fileChunks.every((c) => fileVersionHashes.has(chunkContentHash(c)))
      ) {
        skippedFiles++;
        skippedChunks += fileChunks.length;
        continue;
      }

      for (const chunk of fileChunks) {
        if (!embeddedByContentHash.has(chunkContentHash(chunk))) {
          chunksToEmbed.push(chunk);
        }
      }
    }

    if (skippedFiles > 0) {
      this.logger.verbose(
        `⏭️ Skipped ${skippedFiles} unchanged version(s) (${skippedChunks} chunks)`,
      );
    }

    return { chunksToEmbed, meta: existingMeta, isNewEmbeddingSpace: false };
  }

  async saveEmbeddings(
    db: EmbeddingsDb,
    newEmbeddings: EmbeddedChunk[],
    meta: EmbeddingsMeta,
  ): Promise<void> {
    db.setMeta(meta);
    db.insert(newEmbeddings);
    this.logger.verbose(`Saved ${newEmbeddings.length} new embeddings to db`);
  }

  async run(
    db: EmbeddingsDb,
    chunksFile: string,
    force: boolean = false,
    onIntermediateBatch?: () => Promise<void>,
  ): Promise<EmbeddedChunk[]> {
    this.logger.info("🔢 Starting incremental embedding generation...");

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

    const { chunksToEmbed, meta: existingMeta } = await this.getChunksToEmbed(
      db,
      chunks,
      force,
    );

    if (chunksToEmbed.length === 0) {
      this.logger.info("✨ No chunks need embedding.");
      return [];
    }

    this.logger.info(`📝 Need to embed ${chunksToEmbed.length} chunks`);

    const now = Math.floor(Date.now() / 1000);
    const batches = batchBySize(
      chunksToEmbed,
      this.batchSize,
      (c) => c.content.length,
      this.maxBatchChars,
    );
    const newEmbeddings: EmbeddedChunk[] = [];

    for (let i = 0; i < batches.length; i++) {
      const totalChars = batches[i].reduce((s, c) => s + c.content.length, 0);
      this.logger.debug(
        `Batch ${i + 1}/${batches.length}: ${batches[i].length} chunks, ~${totalChars} chars`,
      );
      const embedded = await this.embedBatch(batches[i]);
      newEmbeddings.push(...embedded);
      this.onProgress?.(newEmbeddings.length, chunksToEmbed.length);

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
        createdAt: existingMeta?.createdAt ?? now,
        updatedAt: now,
      };
      await this.saveEmbeddings(db, embedded, meta);

      if (
        onIntermediateBatch &&
        db.pendingCount() >= this.minIngestionBatchSize
      ) {
        await onIntermediateBatch();
      }
    }

    return newEmbeddings;
  }
}

import {
  VectorStore,
  VectorDocument,
  EmbeddedChunk,
} from "../interfaces/index.js";
import type { Logger } from "../interfaces/logger.js";
import { NullLogger } from "../logger/null-logger.js";
import { createHash } from "crypto";
import { withRetry, RetryOptions } from "./utils.js";
import { VirageDb } from "./virage-db.js";

function contentHash(chunk: EmbeddedChunk): string {
  return (
    chunk.contentHash ??
    createHash("sha256").update(chunk.content).digest("hex").slice(0, 16)
  );
}

export function isFatalVectorStoreError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  return /schema error|schema mismatch|unauthorized|authentication failed/.test(
    msg,
  );
}

export class Uploader {
  private vectorStore: VectorStore;
  private retryOptions: RetryOptions;
  private logger: Logger;

  constructor(
    vectorStore: VectorStore,
    options: { retry?: RetryOptions; logger?: Logger } = {},
  ) {
    this.vectorStore = vectorStore;
    this.retryOptions = options.retry ?? {};
    this.logger = (options.logger ?? new NullLogger()).withTag("upload");
  }

  private chunkToDocument(
    chunk: EmbeddedChunk,
    collection?: string,
  ): VectorDocument {
    const hash = contentHash(chunk);
    return {
      id: hash,
      content: chunk.content,
      metadata: { ...chunk.metadata, contentHash: hash },
      embedding: chunk.embedding,
      sourceFile: chunk.sourceFile,
      commitHash: chunk.commitHash,
      contentHash: hash,
      collection,
    };
  }

  /**
   * Deduplicates chunks by content hash before upsert. Multiple source files can
   * produce chunks with identical content (and therefore the same id), which causes
   * LanceDB's mergeInsert to reject the batch. We keep only the first occurrence per
   * id but still mark ALL hashes as uploaded so SQLite doesn't re-queue the dupes.
   */
  private deduplicateByContentHash(chunks: EmbeddedChunk[]): EmbeddedChunk[] {
    const seen = new Set<string>();
    return chunks.filter((c) => {
      const h = contentHash(c);
      if (seen.has(h)) return false;
      seen.add(h);
      return true;
    });
  }

  async getItemsToUpload(
    db: VirageDb,
    force: boolean = false,
  ): Promise<{
    toUpload: EmbeddedChunk[];
    toDelete: string[];
  }> {
    const meta = db.getMeta();
    const embeddings = db.getAll();

    this.logger.info(`📖 Loaded ${embeddings.length} embeddings from db`);

    // If the vector store changed since the last run, force a full re-upload.
    let effectiveForce = force;
    if (
      !force &&
      meta?.vectorStoreName &&
      meta.vectorStoreName !== this.vectorStore.name
    ) {
      this.logger.warn(`⚠️ Vector store changed!`);
      this.logger.warn(`   Previous: ${meta.vectorStoreName}`);
      this.logger.warn(`   Current:  ${this.vectorStore.name}`);
      this.logger.warn(`   Forcing full re-upload to the new store.`);
      effectiveForce = true;
    }

    if (effectiveForce) {
      const allSourceFiles = [...new Set(embeddings.map((e) => e.sourceFile))];
      return { toUpload: embeddings, toDelete: allSourceFiles };
    }

    const existingState = await this.vectorStore.getCurrentState();
    this.logger.debug(
      `Vector store has ${existingState.size} source version(s)`,
    );

    const toUploadList: EmbeddedChunk[] = [];
    const toDeleteSet = new Set<string>();

    for (const emb of embeddings) {
      const existingHash = existingState.get(emb.sourceFile);

      if (!existingHash) {
        this.logger.trace(
          `  ${emb.sourceFile}: store=(none), local=${emb.commitHash.slice(0, 8)} → upload`,
        );
        toUploadList.push(emb);
      } else if (existingHash !== emb.commitHash) {
        this.logger.trace(
          `  ${emb.sourceFile}: store=${existingHash.slice(0, 8)}, local=${emb.commitHash.slice(0, 8)} → update`,
        );
        toDeleteSet.add(emb.sourceFile);
        toUploadList.push(emb);
      } else {
        this.logger.trace(
          `  ${emb.sourceFile}: store=${existingHash.slice(0, 8)} → unchanged`,
        );
      }
    }

    return {
      toUpload: toUploadList,
      toDelete: [...toDeleteSet],
    };
  }

  /**
   * Called once before the streaming loop. Deletes stale vector store entries for
   * all files that will be re-chunked (toProcess) or removed (toDelete).
   * On force mode or vector-store change, deletes all tracked source files.
   */
  async prepareUpdate(
    db: VirageDb,
    toDelete: string[],
    toProcess: string[],
    force: boolean = false,
  ): Promise<void> {
    await this.vectorStore.initialize();

    const meta = db.getMeta();
    const storeChanged =
      !force &&
      !!meta?.vectorStoreName &&
      meta.vectorStoreName !== this.vectorStore.name;

    let filesToDelete: string[];

    if (force || storeChanged) {
      filesToDelete = [...db.getFileStates().keys()];
      if (storeChanged) {
        this.logger.warn(
          `⚠️ Vector store changed from ${meta!.vectorStoreName} to ${this.vectorStore.name} — forcing full re-upload.`,
        );
      }
    } else {
      filesToDelete = [...new Set([...toDelete, ...toProcess])];
    }

    if (filesToDelete.length > 0) {
      await withRetry(
        () => this.vectorStore.deleteBySourceFile(filesToDelete),
        {
          ...this.retryOptions,
          isRetryable: (err) => !isFatalVectorStoreError(err),
        },
        this.logger,
      );
      this.logger.verbose(
        `🗑️ Deleted ${filesToDelete.length} source file(s) from vector store`,
      );
    }
  }

  /**
   * Upload a batch of embedded chunks to the vector store, then mark them
   * uploaded and clear the embedding BLOB to reclaim storage.
   */
  async upsertBatch(db: VirageDb, chunks: EmbeddedChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const unique = this.deduplicateByContentHash(chunks);
    if (unique.length < chunks.length) {
      this.logger.debug(
        `  Deduped ${chunks.length - unique.length} chunk(s) with shared content hash`,
      );
    }
    const documents = unique.map((e) => this.chunkToDocument(e));
    await withRetry(
      () => this.vectorStore.upsert(documents),
      {
        ...this.retryOptions,
        isRetryable: (err) => !isFatalVectorStoreError(err),
      },
      this.logger,
    );
    // Mark ALL hashes (including the deduped ones) so they don't re-queue.
    const hashes = chunks.map((e) => contentHash(e));
    db.markUploaded(hashes);
    for (const hash of hashes) {
      db.clearEmbedding(hash);
    }
  }

  async uploadPending(
    db: VirageDb,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ uploaded: number; deleted: number }> {
    const pending = db.getPending();
    if (pending.length === 0) return { uploaded: 0, deleted: 0 };

    this.logger.verbose(`📤 Uploading ${pending.length} pending embeddings...`);

    const batchSize = 50;
    let uploaded = 0;
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      const unique = this.deduplicateByContentHash(batch);
      const documents = unique.map((e) => this.chunkToDocument(e));
      await withRetry(
        () => this.vectorStore.upsert(documents),
        {
          ...this.retryOptions,
          isRetryable: (err) => !isFatalVectorStoreError(err),
        },
        this.logger,
      );
      db.markUploaded(batch.map((e) => contentHash(e)));
      uploaded += batch.length;
      onProgress?.(uploaded, pending.length);
    }

    return { uploaded: pending.length, deleted: 0 };
  }

  async sync(
    db: VirageDb,
    force: boolean = false,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{
    uploaded: number;
    deleted: number;
  }> {
    this.logger.info("📤 Starting incremental upload...");

    await this.vectorStore.initialize();

    const { toUpload, toDelete } = await this.getItemsToUpload(db, force);

    this.logger.info(`📊 Need to upload: ${toUpload.length} documents`);
    this.logger.info(`   Need to delete: ${toDelete.length} files`);

    if (toUpload.length === 0 && toDelete.length === 0) {
      this.logger.info("✨ No changes detected.");
      return { uploaded: 0, deleted: 0 };
    }

    if (toDelete.length > 0) {
      await withRetry(
        () => this.vectorStore.deleteBySourceFile(toDelete),
        {
          ...this.retryOptions,
          isRetryable: (err) => !isFatalVectorStoreError(err),
        },
        this.logger,
      );
      this.logger.verbose(`🗑️ Deleted ${toDelete.length} obsolete docs`);
    }

    if (toUpload.length > 0) {
      const batchSize = 50;
      const totalBatches = Math.ceil(toUpload.length / batchSize);
      let uploaded = 0;
      for (let i = 0; i < toUpload.length; i += batchSize) {
        const batch = toUpload.slice(i, i + batchSize);
        const unique = this.deduplicateByContentHash(batch);
        const documents = unique.map((e) => this.chunkToDocument(e));
        await withRetry(
          () => this.vectorStore.upsert(documents),
          {
            ...this.retryOptions,
            isRetryable: (err) => !isFatalVectorStoreError(err),
          },
          this.logger,
        );
        db.markUploaded(batch.map((e) => contentHash(e)));
        uploaded += batch.length;
        onProgress?.(uploaded, toUpload.length);
        const batchNum = Math.floor(i / batchSize) + 1;
        this.logger.verbose(
          `  Batch ${batchNum}/${totalBatches}: ${batch.length} docs`,
        );
        this.logger.silly(
          `  IDs: ${batch
            .map((d) => d.contentHash?.slice(0, 8) ?? "?")
            .join(", ")}`,
        );
      }
    }

    this.logger.verbose(`✨ Upload complete!`);
    this.logger.verbose(`   Uploaded: ${toUpload.length}`);
    this.logger.verbose(`   Deleted: ${toDelete.length}`);

    return { uploaded: toUpload.length, deleted: toDelete.length };
  }
}

import {
  VectorStore,
  VectorDocument,
  EmbeddedChunk,
} from "../interfaces/index.js";
import { createHash } from "crypto";
import { UploadError } from "./errors.js";
import { withRetry, RetryOptions } from "./utils.js";
import { readEmbeddingsFile } from "./embeddings-io.js";

function contentHash(chunk: EmbeddedChunk): string {
  return (
    chunk.contentHash ??
    createHash("sha256").update(chunk.content).digest("hex").slice(0, 16)
  );
}

export class Uploader {
  private vectorStore: VectorStore;
  private retryOptions: RetryOptions;

  constructor(
    vectorStore: VectorStore,
    options: { retry?: RetryOptions } = {},
  ) {
    this.vectorStore = vectorStore;
    this.retryOptions = options.retry ?? {};
  }

  private chunkToDocument(
    chunk: EmbeddedChunk,
    collection?: string,
  ): VectorDocument {
    return {
      content: chunk.content,
      metadata: chunk.metadata,
      embedding: chunk.embedding,
      sourceFile: chunk.sourceFile,
      commitHash: chunk.commitHash,
      contentHash: contentHash(chunk),
      collection,
    };
  }

  async getItemsToUpload(
    embeddingsFile: string,
    force: boolean = false,
  ): Promise<{
    toUpload: EmbeddedChunk[];
    toDelete: string[];
  }> {
    let result: Awaited<ReturnType<typeof readEmbeddingsFile>>;
    try {
      result = await readEmbeddingsFile(embeddingsFile);
    } catch (err) {
      throw new UploadError(
        `Failed to load embeddings from ${embeddingsFile}: ${err instanceof Error ? err.message : String(err)}`,
        {
          suggestion:
            "Run the pipeline without --skip-upload to regenerate embeddings first.",
          cause: err,
        },
      );
    }

    const { meta, chunks: embeddings } = result;

    if (embeddings.length === 0 && !result) {
      throw new UploadError(`No embeddings found at ${embeddingsFile}`, {
        suggestion:
          "Run the pipeline without --skip-upload to regenerate embeddings first.",
      });
    }

    console.log(
      `📖 Loaded ${embeddings.length} embeddings from ${embeddingsFile}`,
    );

    // If the vector store changed since the last run, force a full re-upload to ensure
    // the new store starts with consistent state.
    let effectiveForce = force;
    if (
      !force &&
      meta?.vectorStoreName &&
      meta.vectorStoreName !== this.vectorStore.name
    ) {
      console.log(`\n⚠️  Vector store changed!`);
      console.log(`    Previous: ${meta.vectorStoreName}`);
      console.log(`    Current:  ${this.vectorStore.name}`);
      console.log(`    Forcing full re-upload to the new store.\n`);
      effectiveForce = true;
    }

    if (effectiveForce) {
      const allSourceFiles = [...new Set(embeddings.map((e) => e.sourceFile))];
      return { toUpload: embeddings, toDelete: allSourceFiles };
    }

    const existingState = await this.vectorStore.getCurrentState();
    const toUploadList: EmbeddedChunk[] = [];
    const toDeleteSet = new Set<string>();

    for (const emb of embeddings) {
      const existingHash = existingState.get(emb.sourceFile);

      if (!existingHash) {
        toUploadList.push(emb);
      } else if (existingHash !== emb.commitHash) {
        toDeleteSet.add(emb.sourceFile);
        toUploadList.push(emb);
      }
    }

    return {
      toUpload: toUploadList,
      toDelete: [...toDeleteSet],
    };
  }

  async sync(
    embeddingsFile: string,
    force: boolean = false,
  ): Promise<{
    uploaded: number;
    deleted: number;
  }> {
    console.log("📤 Starting incremental upload...");

    await this.vectorStore.initialize();

    const { toUpload, toDelete } = await this.getItemsToUpload(
      embeddingsFile,
      force,
    );

    console.log(`\n📊 Need to upload: ${toUpload.length} documents`);
    console.log(`   Need to delete: ${toDelete.length} files`);

    if (toUpload.length === 0 && toDelete.length === 0) {
      console.log("\n✨ No changes detected.");
      return { uploaded: 0, deleted: 0 };
    }

    if (toDelete.length > 0) {
      await withRetry(
        () => this.vectorStore.deleteBySourceFile(toDelete),
        this.retryOptions,
      );
      console.log(`  🗑️ Deleted ${toDelete.length} obsolete documents`);
    }

    if (toUpload.length > 0) {
      const documents = toUpload.map((e) => this.chunkToDocument(e));

      const batchSize = 50;
      for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        await withRetry(
          () => this.vectorStore.upsert(batch),
          this.retryOptions,
        );
        console.log(
          `  ✅ Uploaded batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(documents.length / batchSize)}`,
        );
      }
    }

    console.log(`\n✨ Upload complete!`);
    console.log(`   Uploaded: ${toUpload.length}`);
    console.log(`   Deleted: ${toDelete.length}`);

    return { uploaded: toUpload.length, deleted: toDelete.length };
  }
}

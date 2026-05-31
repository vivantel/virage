import {
  VectorStore,
  VectorDocument,
  EmbeddedChunk,
} from "../interfaces/index.js";
import { readFile } from "fs/promises";

export class Uploader {
  private vectorStore: VectorStore;

  constructor(vectorStore: VectorStore) {
    this.vectorStore = vectorStore;
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
      contentHash: chunk.contentHash!,
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
    let embeddings: EmbeddedChunk[];
    try {
      const content = await readFile(embeddingsFile, "utf-8");
      embeddings = JSON.parse(content);
    } catch {
      throw new Error(`Embeddings file not found: ${embeddingsFile}`);
    }

    console.log(
      `📖 Loaded ${embeddings.length} embeddings from ${embeddingsFile}`,
    );

    if (force) {
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
      await this.vectorStore.deleteBySourceFile(toDelete);
      console.log(`  🗑️ Deleted ${toDelete.length} obsolete documents`);
    }

    if (toUpload.length > 0) {
      const documents = toUpload.map((e) => this.chunkToDocument(e));

      const batchSize = 50;
      for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        await this.vectorStore.upsert(batch);
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

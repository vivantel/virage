import {
  EmbeddingProvider,
  EmbeddedChunk,
  Chunk,
} from "../interfaces/index.js";
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { createHash } from "crypto";
import { EmbedError } from "./errors.js";

function chunkContentHash(chunk: Chunk): string {
  if (chunk.contentHash) return chunk.contentHash;
  return createHash("sha256").update(chunk.content).digest("hex").slice(0, 16);
}

export class EmbedderProcessor {
  private provider: EmbeddingProvider;
  private rateLimitMs: number;
  private batchSize: number;

  constructor(
    provider: EmbeddingProvider,
    options: { rateLimitMs?: number; batchSize?: number } = {},
  ) {
    this.provider = provider;
    this.rateLimitMs = options.rateLimitMs ?? 500;
    this.batchSize = options.batchSize ?? 10;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async embedChunk(chunk: Chunk): Promise<EmbeddedChunk> {
    const embedding = await this.provider.embed(chunk.content);

    return {
      ...chunk,
      embedding,
      embeddedAt: Date.now() / 1000,
    };
  }

  async embedBatch(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    const results: EmbeddedChunk[] = [];

    if (this.provider.embedBatch && chunks.length >= this.batchSize) {
      const texts = chunks.map((c) => c.content);
      const embeddings = await this.provider.embedBatch(texts);

      if (embeddings.length !== chunks.length) {
        throw new EmbedError(
          `embedBatch returned ${embeddings.length} embeddings for ${chunks.length} chunks`,
          {
            suggestion:
              "Check that your EmbeddingProvider.embedBatch() returns one vector per input text.",
          },
        );
      }

      for (let i = 0; i < chunks.length; i++) {
        results.push({
          ...chunks[i],
          embedding: embeddings[i],
          embeddedAt: Date.now() / 1000,
        });
      }
    } else {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const eventType =
          (chunk.metadata.event_type as string) ||
          (chunk.metadata.title as string) ||
          chunk.sourceFile.split("/").pop() ||
          "unknown";

        console.log(`  [${i + 1}/${chunks.length}] ${eventType}`);

        const embedded = await this.embedChunk(chunk);
        results.push(embedded);

        if (this.rateLimitMs > 0 && i < chunks.length - 1) {
          await this.sleep(this.rateLimitMs);
        }
      }
    }

    return results;
  }

  async getChunksToEmbed(
    chunksFile: string,
    force: boolean = false,
  ): Promise<{
    chunksToEmbed: Chunk[];
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
      return { chunksToEmbed: chunks };
    }

    let existingEmbeddings: EmbeddedChunk[] = [];
    const embeddingsFile = chunksFile.replace("chunks", "embeddings");
    try {
      const content = await readFile(embeddingsFile, "utf-8");
      existingEmbeddings = JSON.parse(content);
    } catch {
      // No existing embeddings
    }

    const existingState = new Map<string, EmbeddedChunk>();
    for (const emb of existingEmbeddings) {
      const hash = emb.contentHash || chunkContentHash(emb);
      existingState.set(hash, emb);
    }

    console.log(`📊 Existing embeddings: ${existingState.size} chunks`);

    const chunksToEmbed: Chunk[] = [];
    for (const chunk of chunks) {
      const chunkHash = chunkContentHash(chunk);
      if (!existingState.has(chunkHash)) {
        chunksToEmbed.push(chunk);
      }
    }

    return { chunksToEmbed };
  }

  async saveEmbeddings(
    newEmbeddings: EmbeddedChunk[],
    chunksFile: string,
    force: boolean = false,
  ): Promise<void> {
    const embeddingsFile = chunksFile.replace("chunks", "embeddings");
    await mkdir(dirname(embeddingsFile), { recursive: true });

    const newByHash = new Map<string, EmbeddedChunk>();
    for (const emb of newEmbeddings) {
      const hash = emb.contentHash || chunkContentHash(emb);
      newByHash.set(hash, emb);
    }

    let existing: EmbeddedChunk[] = [];
    if (!force) {
      try {
        const content = await readFile(embeddingsFile, "utf-8");
        existing = JSON.parse(content);
      } catch {
        // No existing embeddings
      }
    }

    const final = force
      ? []
      : existing.filter((e) => {
          const hash = e.contentHash || chunkContentHash(e);
          return !newByHash.has(hash);
        });

    final.push(...newEmbeddings);

    await writeFile(embeddingsFile, JSON.stringify(final, null, 2));
    console.log(`\n💾 Saved ${final.length} embeddings to ${embeddingsFile}`);
    console.log(
      `   New: ${newEmbeddings.length}, Existing: ${final.length - newEmbeddings.length}`,
    );
  }

  async run(
    chunksFile: string,
    force: boolean = false,
  ): Promise<EmbeddedChunk[]> {
    console.log("🔢 Starting incremental embedding generation...");

    const { chunksToEmbed } = await this.getChunksToEmbed(chunksFile, force);

    if (chunksToEmbed.length === 0) {
      console.log("\n✨ No chunks need embedding.");
      return [];
    }

    console.log(`\n📝 Need to embed ${chunksToEmbed.length} chunks`);

    const newEmbeddings = await this.embedBatch(chunksToEmbed);
    await this.saveEmbeddings(newEmbeddings, chunksFile, force);

    return newEmbeddings;
  }
}

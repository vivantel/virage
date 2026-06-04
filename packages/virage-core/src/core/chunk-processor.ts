import { Chunk, FileChunker } from "../interfaces/index.js";
import type { Logger } from "../interfaces/logger.js";
import { NullLogger } from "../logger/null-logger.js";
import { createHash } from "crypto";

function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export class ChunkProcessor {
  private chunkers: Map<string, FileChunker>;
  private logger: Logger;

  constructor(chunkers: FileChunker[], logger?: Logger) {
    this.chunkers = new Map(chunkers.map((c) => [c.name, c]));
    this.logger = (logger ?? new NullLogger()).withTag("chunks");
  }

  async processFile(
    filePath: string,
    commitHash: string,
    chunker: FileChunker,
  ): Promise<Chunk[]> {
    const chunks = await chunker.chunk(filePath, commitHash);

    for (const chunk of chunks) {
      chunk.contentHash = computeContentHash(chunk.content);
      chunk.sourceFile = filePath;
      chunk.commitHash = commitHash;
    }

    return chunks;
  }

  async processFiles(
    files: string[],
    fileState: Map<string, { commitHash: string; chunker: FileChunker }>,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<Chunk[]> {
    const allChunks: Chunk[] = [];
    let errorCount = 0;

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const info = fileState.get(filePath);

      if (!info) {
        this.logger.warn(`⚠️ No chunker for: ${filePath}`);
        continue;
      }

      this.logger.verbose(`[${i + 1}/${files.length}] ${filePath}`);

      try {
        const chunks = await this.processFile(
          filePath,
          info.commitHash,
          info.chunker,
        );

        if (chunks.length > 0) {
          allChunks.push(...chunks);
          this.logger.verbose(`  ✅ ${chunks.length} chunk(s)`);
          for (let j = 0; j < chunks.length; j++) {
            this.logger.debug(
              `  Chunk ${j}: contentHash=${chunks[j].contentHash} len=${chunks[j].content.length}`,
            );
          }
        } else {
          this.logger.warn(`  ⚠️ No chunks generated`);
        }
      } catch (error) {
        errorCount++;
        this.logger.error(
          `  ❌ Error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      onProgress?.(i + 1, files.length);
    }

    if (errorCount > 0) {
      this.logger.warn(`⚠️ ${errorCount} file(s) failed during chunking.`);
    }

    return allChunks;
  }
}

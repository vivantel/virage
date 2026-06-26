import { Chunk, FileChunker } from "../interfaces/index.js";
import type { Logger } from "../interfaces/logger.js";
import { NullLogger } from "../logger/null-logger.js";
import { computeDenseTextHash } from "./chunk-utils.js";
import { createHash } from "node:crypto";

function makeGeneratorId(name: string, version: string, role: string): string {
  return createHash("sha256")
    .update(`${name}@${version}:${role}:{}`)
    .digest("hex")
    .slice(0, 16);
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
    const normalizedPath = filePath.replace(/\\/g, "/");
    const chunks = await chunker.chunk(normalizedPath, commitHash);

    for (const chunk of chunks) {
      chunk.sourceFile = normalizedPath;
      chunk.commitHash = commitHash;
      // Legacy adapter: chunkers built against virage-chunker-ce-ast <0.2 returned
      // `content` instead of `denseText`/`sparseText`. Bridge that here so the
      // published packages continue to work until they are updated and republished.
      const raw = chunk as unknown as Record<string, unknown>;
      if (!chunk.denseText && typeof raw["content"] === "string") {
        chunk.denseText = raw["content"] as string;
      }
      if (!chunk.sparseText && typeof raw["content"] === "string") {
        chunk.sparseText = raw["content"] as string;
      }
      // Safety net: compute denseTextHash if missing.
      if (!chunk.denseTextHash && chunk.denseText) {
        chunk.denseTextHash = computeDenseTextHash(chunk.denseText);
      }
      if (!chunk.sparseTextGeneratorId) {
        chunk.sparseTextGeneratorId = makeGeneratorId(
          chunker.name,
          chunker.version ?? "0.0.0",
          "sparse",
        );
      }
      if (!chunk.metadataGeneratorId) {
        chunk.metadataGeneratorId = makeGeneratorId(
          chunker.name,
          chunker.version ?? "0.0.0",
          "meta",
        );
      }
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
              `  Chunk ${j}: denseTextHash=${chunks[j].denseTextHash} len=${chunks[j].denseText.length}`,
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

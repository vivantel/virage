import { Chunk, ChunkerEntry } from "../interfaces/index.js";
import type { Logger } from "../interfaces/logger.js";
import { NullLogger } from "../logger/null-logger.js";
import { computeDenseTextHash } from "./chunk-utils.js";
import { resolveFileTags } from "./tag-pipeline.js";
import { createHash } from "node:crypto";

function makeGeneratorId(name: string, version: string, role: string): string {
  return createHash("sha256")
    .update(`${name}@${version}:${role}:{}`)
    .digest("hex")
    .slice(0, 16);
}

export class ChunkProcessor {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = (logger ?? new NullLogger()).withTag("chunks");
  }

  async processEntries(
    filePath: string,
    commitHash: string,
    entries: ChunkerEntry[],
  ): Promise<Chunk[]> {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const allChunks: Chunk[] = [];

    for (const entry of entries) {
      let chunks: Chunk[];
      try {
        chunks = await entry.chunker.chunk(normalizedPath, commitHash);
      } catch (err) {
        this.logger.error(
          `Chunker "${entry.chunkerKey}" failed on ${normalizedPath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        continue;
      }

      const fileTags = resolveFileTags(
        normalizedPath,
        entry.fileSetTags,
        entry.tagRules,
      );

      for (const chunk of chunks) {
        chunk.sourceFile = normalizedPath;
        chunk.commitHash = commitHash;

        // Legacy adapter: chunkers built against virage-chunker-ce-ast <0.2
        const raw = chunk as unknown as Record<string, unknown>;
        if (!chunk.denseText && typeof raw["content"] === "string") {
          chunk.denseText = raw["content"] as string;
        }
        if (!chunk.sparseText && typeof raw["content"] === "string") {
          chunk.sparseText = raw["content"] as string;
        }

        if (!chunk.denseTextHash && chunk.denseText) {
          chunk.denseTextHash = computeDenseTextHash(chunk.denseText);
        }
        if (!chunk.sparseTextGeneratorId) {
          chunk.sparseTextGeneratorId = makeGeneratorId(
            entry.chunker.name,
            entry.chunker.version ?? "0.0.0",
            "sparse",
          );
        }
        if (!chunk.metadataGeneratorId) {
          chunk.metadataGeneratorId = makeGeneratorId(
            entry.chunker.name,
            entry.chunker.version ?? "0.0.0",
            "meta",
          );
        }

        // Inject tags (ADR-043, ADR-046)
        const meta = chunk.metadata as unknown as Record<string, unknown>;
        if (fileTags.length > 0 && meta) {
          const existing = meta["tags"] as string[] | undefined;
          meta["tags"] = existing
            ? [...new Set([...existing, ...fileTags])]
            : [...fileTags];
        }

        // Set chunkerKey (ADR-044)
        if (meta) {
          meta["chunkerKey"] = entry.chunkerKey;
        }

        // Apply templates (ADR-045) — no-op stub until virage-renderer-minijinja ships
        if (entry.templates) {
          this.logger.debug(
            `[templates] ${entry.chunkerKey} → templates configured but renderer not available; skipping`,
          );
        }
      }

      allChunks.push(...chunks);
    }

    return allChunks;
  }

  async processFiles(
    files: string[],
    fileState: Map<string, { commitHash: string; entries: ChunkerEntry[] }>,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<Chunk[]> {
    const allChunks: Chunk[] = [];
    let errorCount = 0;

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const info = fileState.get(filePath);

      if (!info) {
        this.logger.warn(`⚠️ No chunker entries for: ${filePath}`);
        continue;
      }

      this.logger.verbose(`[${i + 1}/${files.length}] ${filePath}`);

      try {
        const chunks = await this.processEntries(
          filePath,
          info.commitHash,
          info.entries,
        );

        if (chunks.length > 0) {
          allChunks.push(...chunks);
          this.logger.verbose(`  ✅ ${chunks.length} chunk(s)`);
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

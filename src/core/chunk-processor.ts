import { Chunk, FileChunker } from "../interfaces/index.js";
import { createHash } from "crypto";

function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export class ChunkProcessor {
  private chunkers: Map<string, FileChunker>;

  constructor(chunkers: FileChunker[]) {
    this.chunkers = new Map(chunkers.map((c) => [c.name, c]));
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
    existingChunks: Chunk[] = [],
  ): Promise<Chunk[]> {
    const allChunks: Chunk[] = [];
    let errorCount = 0;

    // Build resume cache: sourceFile → { commitHash, chunks }
    const resumeCache = new Map<
      string,
      { commitHash: string; chunks: Chunk[] }
    >();
    for (const chunk of existingChunks) {
      const entry = resumeCache.get(chunk.sourceFile);
      if (!entry) {
        resumeCache.set(chunk.sourceFile, {
          commitHash: chunk.commitHash,
          chunks: [chunk],
        });
      } else {
        entry.chunks.push(chunk);
      }
    }

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const info = fileState.get(filePath);

      if (!info) {
        console.log(`  ⚠️ No chunker for: ${filePath}`);
        continue;
      }

      // Resume: reuse cached chunks when commitHash matches
      const cached = resumeCache.get(filePath);
      if (cached && cached.commitHash === info.commitHash) {
        console.log(`  [${i + 1}/${files.length}] ${filePath}`);
        console.log(`    ⏭️  Cached (${cached.chunks.length} chunk(s))`);
        allChunks.push(...cached.chunks);
        continue;
      }

      console.log(`  [${i + 1}/${files.length}] ${filePath}`);

      try {
        const chunks = await this.processFile(
          filePath,
          info.commitHash,
          info.chunker,
        );

        if (chunks.length > 0) {
          allChunks.push(...chunks);
          console.log(`    ✅ Generated ${chunks.length} chunk(s)`);
        } else {
          console.log(`    ⚠️ No chunks generated (skipped)`);
        }
      } catch (error) {
        errorCount++;
        console.error(`    ❌ Error processing ${filePath}: ${error}`);
      }
    }

    if (errorCount > 0) {
      console.warn(`\n⚠️ ${errorCount} file(s) failed during chunking.`);
    }

    return allChunks;
  }

  async saveChunksLocal(chunks: Chunk[], outputFile: string): Promise<void> {
    const { dirname } = await import("path");
    const { mkdir, writeFile, readFile } = await import("fs/promises");

    await mkdir(dirname(outputFile), { recursive: true });

    let existing: Chunk[] = [];
    try {
      const content = await readFile(outputFile, "utf-8");
      const parsed: unknown = JSON.parse(content);
      if (Array.isArray(parsed)) {
        existing = parsed as Chunk[];
      }
    } catch {
      // File doesn't exist or is not valid JSON — start fresh
    }

    const processedFiles = new Set(chunks.map((c) => c.sourceFile));
    const filtered = existing.filter((c) => !processedFiles.has(c.sourceFile));

    const allChunks = [...filtered, ...chunks];

    await writeFile(outputFile, JSON.stringify(allChunks, null, 2));
    console.log(`\n💾 Saved ${allChunks.length} chunks to ${outputFile}`);
  }
}

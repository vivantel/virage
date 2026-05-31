/**
 * Example: implementing a custom FileChunker directly (without createChunker).
 * Use this when you need more control than createChunker provides.
 */
import { FileChunker, Chunk } from "@vivantel/rag-core";
import { readFile } from "fs/promises";

export const yamlEventChunker: FileChunker = {
  name: "yaml-events",
  patterns: ["events/**/*.yaml", "events/**/*.yml"],

  async canProcess(filePath: string): Promise<boolean> {
    return filePath.includes("events/");
  },

  async chunk(filePath: string, commitHash: string): Promise<Chunk[]> {
    const raw = await readFile(filePath, "utf-8");

    // Example: split on YAML document separators (---)
    const documents = raw.split(/^---$/m).filter((d) => d.trim());

    return documents.map((doc, i) => ({
      content: doc.trim(),
      metadata: {
        index: i,
        source: filePath,
      },
      sourceFile: filePath,
      commitHash,
    }));
  },
};

import { FileChunker, Chunk } from "../interfaces/index.js";

export interface CreateChunkerOptions {
  name: string;
  patterns: string[];
  process: (
    content: string,
    filePath: string,
    commitHash: string,
  ) => Promise<Chunk[]>;
  canProcess?: (filePath: string, content?: string) => Promise<boolean>;
}

export function createChunker(options: CreateChunkerOptions): FileChunker {
  return {
    name: options.name,
    patterns: options.patterns,

    async chunk(filePath: string, commitHash: string): Promise<Chunk[]> {
      const { readFile } = await import("fs/promises");
      const content = await readFile(filePath, "utf-8");

      if (options.canProcess) {
        const canProcess = await options.canProcess(filePath, content);
        if (!canProcess) {
          return [];
        }
      }

      return options.process(content, filePath, commitHash);
    },

    async canProcess(filePath: string, content?: string): Promise<boolean> {
      if (options.canProcess) {
        return options.canProcess(filePath, content);
      }
      return true;
    },
  };
}

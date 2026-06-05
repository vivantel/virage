import { FileChunker, ChunkStrategy, Chunk } from "../interfaces/index.js";
import { minimatch } from "minimatch";

type WithStrategy = {
  strategy: ChunkStrategy;
  process?: never;
  name?: string;
};

type WithProcess = {
  process: (
    content: string,
    filePath: string,
    commitHash: string,
  ) => Promise<Chunk[]>;
  strategy?: never;
  name: string;
};

export type CreateChunkerOptions = {
  patterns: string[];
  ignorePatterns?: string[];
  canProcess?: (filePath: string, content?: string) => Promise<boolean>;
} & (WithStrategy | WithProcess);

export function createChunker(options: CreateChunkerOptions): FileChunker {
  let name: string;
  let processContent: (
    content: string,
    filePath: string,
    commitHash: string,
  ) => Promise<Chunk[]>;

  if (options.strategy != null) {
    name = options.name ?? `${options.strategy.name}:${options.patterns[0]}`;
    const strategy = options.strategy;
    processContent = (content, filePath) => strategy.chunk(content, filePath);
  } else {
    name = options.name;
    processContent = options.process;
  }

  return {
    name,
    patterns: options.patterns,

    async chunk(filePath: string, commitHash: string): Promise<Chunk[]> {
      if (
        options.ignorePatterns?.some((p) =>
          minimatch(filePath, p, { matchBase: true }),
        )
      ) {
        return [];
      }

      const { readFile } = await import("fs/promises");
      const content = await readFile(filePath, "utf-8");

      if (options.canProcess) {
        const canProcess = await options.canProcess(filePath, content);
        if (!canProcess) {
          return [];
        }
      }

      return processContent(content, filePath, commitHash);
    },

    async canProcess(filePath: string, content?: string): Promise<boolean> {
      if (
        options.ignorePatterns?.some((p) =>
          minimatch(filePath, p, { matchBase: true }),
        )
      ) {
        return false;
      }
      if (options.canProcess) {
        return options.canProcess(filePath, content);
      }
      return true;
    },
  };
}

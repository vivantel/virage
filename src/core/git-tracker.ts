import { simpleGit, SimpleGit } from "simple-git";
import { glob } from "glob";
import { FileChunker } from "../interfaces/index.js";
import { minimatch } from "minimatch";
import path from "path";

const MAX_FILES_PER_BATCH = 100;
const MAX_CMD_LEN = 32000;

function batchFiles(files: string[]): string[][] {
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentLen = 0;
  const baseCmdLen = "git log -1 --format=%H --all -- ".length;

  for (const file of files) {
    const fileLen = file.length + 1;

    if (
      currentBatch.length >= MAX_FILES_PER_BATCH ||
      currentLen + fileLen > MAX_CMD_LEN
    ) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentLen = baseCmdLen;
      }
    }

    currentBatch.push(file);
    currentLen += fileLen;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

export class GitTracker {
  private git: SimpleGit;
  private chunkers: FileChunker[];
  private allPatterns: string[];
  private currentHeadCache: string | null = null;
  private uncommittedCache: boolean | null = null;

  constructor(chunkers: FileChunker[]) {
    this.git = simpleGit();
    this.chunkers = chunkers;
    this.allPatterns = chunkers.flatMap((c) => c.patterns);
  }

  private async getCurrentHead(): Promise<string> {
    if (!this.currentHeadCache) {
      try {
        this.currentHeadCache = await this.git.revparse(["HEAD"]);
      } catch {
        this.currentHeadCache = "dev_0000000000000000000000000000000000000000";
      }
    }
    return this.currentHeadCache;
  }

  private async hasUncommittedChanges(): Promise<boolean> {
    if (this.uncommittedCache === null) {
      try {
        const status = await this.git.status();
        this.uncommittedCache = status.files.length > 0;
      } catch {
        this.uncommittedCache = false;
      }
    }
    return this.uncommittedCache;
  }

  private getChunkerForFile(filePath: string): FileChunker | null {
    for (const chunker of this.chunkers) {
      for (const pattern of chunker.patterns) {
        if (this.matchesPattern(filePath, pattern)) {
          return chunker;
        }
      }
    }
    return null;
  }

  private matchesPattern(filePath: string, pattern: string): boolean {
    const normalizedPath = filePath.split(path.sep).join("/");
    const normalizedPattern = pattern.split(path.sep).join("/");

    return minimatch(normalizedPath, normalizedPattern);
  }

  async getAllTrackedFiles(): Promise<string[]> {
    const files = await glob(this.allPatterns, { nodir: true });
    return [...new Set(files)].sort();
  }

  async getCommitHashes(files: string[]): Promise<Map<string, string>> {
    const commitMap = new Map<string, string>();
    const batches = batchFiles(files);
    const currentHead = await this.getCurrentHead();

    for (const batch of batches) {
      try {
        const output = await this.git.raw([
          "log",
          "-1",
          "--format=%H",
          "--all",
          "--",
          ...batch,
        ]);
        const lines = output.trim().split("\n");

        for (let i = 0; i < lines.length && i < batch.length; i++) {
          const hash = lines[i].trim();
          if (hash) {
            commitMap.set(batch[i], hash);
          }
        }

        for (const file of batch) {
          if (!commitMap.has(file)) {
            commitMap.set(file, currentHead);
          }
        }
      } catch {
        for (const file of batch) {
          commitMap.set(file, currentHead);
        }
      }
    }

    return commitMap;
  }

  async getCurrentState(): Promise<
    Map<string, { commitHash: string; chunker: FileChunker }>
  > {
    const allFiles = await this.getAllTrackedFiles();
    const commitMap = await this.getCommitHashes(allFiles);
    const hasDirty = await this.hasUncommittedChanges();
    const currentHead = await this.getCurrentHead();

    const state = new Map<
      string,
      { commitHash: string; chunker: FileChunker }
    >();

    for (const file of allFiles) {
      let commitHash = commitMap.get(file) || currentHead;
      if (hasDirty) {
        commitHash = `${commitHash}-dirty`;
      }

      const chunker = this.getChunkerForFile(file);
      if (chunker) {
        state.set(file, { commitHash, chunker });
      }
    }

    return state;
  }

  async getChangedFiles(previousState: Map<string, string>): Promise<{
    toProcess: string[];
    toDelete: string[];
    unchanged: string[];
  }> {
    const current = await this.getCurrentState();
    const toProcess: string[] = [];
    const toDelete: string[] = [];
    const unchanged: string[] = [];

    for (const [filePath, info] of current) {
      const prevHash = previousState.get(filePath);

      if (!prevHash) {
        console.log(`  🆕 New: ${filePath}`);
        toProcess.push(filePath);
      } else if (prevHash !== info.commitHash) {
        console.log(
          `  📝 Changed: ${filePath} (${prevHash.slice(0, 8)} → ${info.commitHash.slice(0, 8)})`,
        );
        toProcess.push(filePath);
      } else {
        unchanged.push(filePath);
      }
    }

    for (const [filePath] of previousState) {
      if (!current.has(filePath)) {
        console.log(`  🗑️ Deleted: ${filePath}`);
        toDelete.push(filePath);
      }
    }

    return { toProcess, toDelete, unchanged };
  }
}

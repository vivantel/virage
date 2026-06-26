import { glob } from "glob";
import { ChunkerEntry, FileChunker } from "../interfaces/index.js";
import type { SourceRepository } from "../interfaces/source-repository.js";
import type { Logger } from "../interfaces/logger.js";
import { NullLogger } from "../logger/null-logger.js";
import { minimatch } from "minimatch";
import path from "path";
import { IGNORED_DIRS } from "./virage-defaults.js";

export class GitTracker {
  private source: SourceRepository;
  private chunkers: ChunkerEntry[];
  private allPatterns: string[];
  private logger: Logger;
  private excludePatterns: string[];

  constructor(
    chunkers: ChunkerEntry[],
    source: SourceRepository,
    logger?: Logger,
    excludePatterns?: string[],
  ) {
    this.chunkers = chunkers;
    this.source = source;
    this.allPatterns = chunkers.flatMap((e) => e.chunker.patterns);
    this.logger = (logger ?? new NullLogger()).withTag("git");
    this.excludePatterns = excludePatterns ?? [];
  }

  /** Returns the current git branch name, or "HEAD" when detached. */
  async getCurrentBranch(): Promise<string> {
    return (await this.source.getContext?.()) ?? "HEAD";
  }

  private getChunkerForFile(filePath: string): FileChunker | null {
    for (const entry of this.chunkers) {
      if (
        entry.include &&
        !entry.include.some((p) => this.matchesPattern(filePath, p))
      )
        continue;
      if (entry.ignore?.some((p) => this.matchesPattern(filePath, p))) continue;
      if (
        entry.chunker.patterns.some((p) => this.matchesPattern(filePath, p))
      ) {
        this.logger.trace(
          `Matched ${filePath} → chunker "${entry.chunker.name}"`,
        );
        return entry.chunker;
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
    const ignore = [
      ...[...IGNORED_DIRS].map((d) => `${d}/**`),
      ...this.excludePatterns,
    ];
    const files = await glob(this.allPatterns, { nodir: true, ignore });
    const unique = [...new Set(files)]
      .filter((f) => {
        if (this.excludePatterns.length === 0) return true;
        const normalized = f.split(path.sep).join("/");
        return !this.excludePatterns.some((p) => minimatch(normalized, p));
      })
      .sort();
    this.logger.debug(
      `Scanned ${unique.length} file(s) matching ${this.allPatterns.length} pattern(s)` +
        (this.excludePatterns.length > 0
          ? ` (${this.excludePatterns.length} exclude pattern(s) applied)`
          : ""),
    );
    return unique;
  }

  async getCurrentState(
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, { commitHash: string; chunker: FileChunker }>> {
    const allFiles = await this.getAllTrackedFiles();
    const revisionMap = await this.source.getFileRevisions(
      allFiles,
      onProgress,
    );
    const currentRevision = await this.source.getCurrentRevision();

    const state = new Map<
      string,
      { commitHash: string; chunker: FileChunker }
    >();

    for (const file of allFiles) {
      const revision = revisionMap.get(file) ?? currentRevision;
      const chunker = this.getChunkerForFile(file);
      if (chunker) {
        state.set(file, { commitHash: revision, chunker });
      }
    }

    return state;
  }

  async getChangedFiles(
    previousState: Map<string, string>,
    currentState?: Map<string, { commitHash: string; chunker: FileChunker }>,
  ): Promise<{
    toProcess: string[];
    toDelete: string[];
    unchanged: string[];
  }> {
    const current = currentState ?? (await this.getCurrentState(undefined));
    const toProcess: string[] = [];
    const toDelete: string[] = [];
    const unchanged: string[] = [];

    for (const [filePath, info] of current) {
      const prevHash = previousState.get(filePath);

      if (!prevHash) {
        this.logger.verbose(`🆕 New: ${filePath}`);
        toProcess.push(filePath);
      } else if (prevHash !== info.commitHash) {
        this.logger.verbose(
          `📝 Changed: ${filePath} (${prevHash.slice(0, 8)} → ${info.commitHash.slice(0, 8)})`,
        );
        toProcess.push(filePath);
      } else {
        unchanged.push(filePath);
      }
    }

    for (const [filePath] of previousState) {
      if (!current.has(filePath)) {
        this.logger.verbose(`🗑️ Deleted: ${filePath}`);
        toDelete.push(filePath);
      }
    }

    return { toProcess, toDelete, unchanged };
  }
}

import { glob } from "glob";
import { ChunkerEntry } from "../interfaces/index.js";
import type { SourceRepository } from "../interfaces/source-repository.js";
import type { Logger } from "../interfaces/logger.js";
import { NullLogger } from "../logger/null-logger.js";
import { minimatch } from "minimatch";
import path from "path";
import { IGNORED_DIRS } from "./virage-defaults.js";

export class GitTracker {
  private source: SourceRepository;
  private entries: ChunkerEntry[];
  private allPatterns: string[];
  private logger: Logger;
  private globalIgnore: string[];

  constructor(
    entries: ChunkerEntry[],
    source: SourceRepository,
    logger?: Logger,
    globalIgnore?: string[],
  ) {
    this.entries = entries;
    this.source = source;
    this.allPatterns = entries.flatMap((e) => e.chunker.patterns);
    this.logger = (logger ?? new NullLogger()).withTag("git");
    this.globalIgnore = globalIgnore ?? [];
  }

  /** Returns the current git branch name, or "HEAD" when detached. */
  async getCurrentBranch(): Promise<string> {
    return (await this.source.getContext?.()) ?? "HEAD";
  }

  private getEntriesForFile(filePath: string): ChunkerEntry[] {
    const matched: ChunkerEntry[] = [];
    for (const entry of this.entries) {
      if (
        entry.include &&
        !entry.include.some((p) => this.matchesPattern(filePath, p))
      )
        continue;
      if (entry.ignore?.some((p) => this.matchesPattern(filePath, p))) continue;
      if (
        entry.chunker.patterns.some((p) => this.matchesPattern(filePath, p))
      ) {
        matched.push(entry);
      }
    }
    return matched;
  }

  private matchesPattern(filePath: string, pattern: string): boolean {
    const normalizedPath = filePath.split(path.sep).join("/");
    const normalizedPattern = pattern.split(path.sep).join("/");
    return minimatch(normalizedPath, normalizedPattern);
  }

  async getAllTrackedFiles(): Promise<string[]> {
    const ignore = [
      ...[...IGNORED_DIRS].map((d) => `${d}/**`),
      ...this.globalIgnore,
    ];
    const normalizedPatterns = this.allPatterns.map((p) =>
      p.split(path.sep).join("/"),
    );
    const normalizedIgnore = ignore.map((p) => p.split(path.sep).join("/"));
    const files = await glob(normalizedPatterns, {
      nodir: true,
      ignore: normalizedIgnore,
    });
    const unique = [...new Set(files.map((f) => f.replace(/\\/g, "/")))]
      .filter((f) => {
        if (this.globalIgnore.length === 0) return true;
        const normalized = f.split(path.sep).join("/");
        return !this.globalIgnore.some((p) => minimatch(normalized, p));
      })
      .sort();
    this.logger.debug(
      `Scanned ${unique.length} file(s) matching ${this.allPatterns.length} pattern(s)` +
        (this.globalIgnore.length > 0
          ? ` (${this.globalIgnore.length} global ignore pattern(s) applied)`
          : ""),
    );
    return unique;
  }

  async getCurrentState(
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, { commitHash: string; entries: ChunkerEntry[] }>> {
    const allFiles = await this.getAllTrackedFiles();
    const revisionMap = await this.source.getFileRevisions(
      allFiles,
      onProgress,
    );
    const currentRevision = await this.source.getCurrentRevision();

    const state = new Map<
      string,
      { commitHash: string; entries: ChunkerEntry[] }
    >();

    for (const file of allFiles) {
      const revision = revisionMap.get(file) ?? currentRevision;
      const fileEntries = this.getEntriesForFile(file);
      if (fileEntries.length > 0) {
        this.logger.trace(
          `Matched ${file} → ${fileEntries.length} chunker(s): ${fileEntries.map((e) => e.chunkerKey).join(", ")}`,
        );
        state.set(file, { commitHash: revision, entries: fileEntries });
      }
    }

    return state;
  }

  async getChangedFiles(
    previousState: Map<string, string>,
    currentState?: Map<string, { commitHash: string; entries: ChunkerEntry[] }>,
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

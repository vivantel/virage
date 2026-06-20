import { simpleGit, SimpleGit } from "simple-git";
import { minimatch } from "minimatch";
import path from "path";
import type { Logger } from "../interfaces/logger.js";
import { NullLogger } from "../logger/null-logger.js";
import type { SourceRepository } from "../interfaces/source-repository.js";

export class CliGitSourceRepository implements SourceRepository {
  private readonly git: SimpleGit;
  private readonly logger: Logger;
  private readonly excludePatterns: string[];
  readonly rootUri: string;

  constructor(dir: string, logger?: Logger, excludePatterns?: string[]) {
    this.rootUri = dir;
    this.git = simpleGit(dir);
    this.logger = (logger ?? new NullLogger()).withTag("git");
    this.excludePatterns = excludePatterns ?? [];
  }

  private isExcluded(filePath: string): boolean {
    if (this.excludePatterns.length === 0) return false;
    const normalized = filePath.split(path.sep).join("/");
    return this.excludePatterns.some((p) => minimatch(normalized, p));
  }

  async getCurrentRevision(): Promise<string> {
    const sha = await this.git.revparse(["HEAD"]);
    return sha.trim();
  }

  async getFileRevisions(
    files: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, string>> {
    if (files.length === 0) return new Map();

    // Run ls-tree and status in parallel — 2 subprocesses regardless of file count
    const [treeOutput, status] = await Promise.all([
      this.git
        .raw(["ls-tree", "-r", "HEAD", "--format=%(objectname) %(path)"])
        .catch(() => ""),
      this.git.status().catch(() => null),
    ]);

    // Build path → blob SHA map from HEAD tree
    const treeMap = new Map<string, string>();
    for (const line of treeOutput.trim().split("\n")) {
      if (!line) continue;
      const spaceIdx = line.indexOf(" ");
      if (spaceIdx < 0) continue;
      treeMap.set(line.slice(spaceIdx + 1), line.slice(0, spaceIdx));
    }

    // Normalize dirty file paths to forward slashes
    const dirtySet = new Set<string>(
      (status?.files ?? []).map((f) => f.path.split(path.sep).join("/")),
    );

    const result = new Map<string, string>();
    let done = 0;

    // Process dirty files with hash-object to get accurate content hash;
    // clean committed files use the blob SHA from the tree (zero extra subprocesses).
    const dirtyFiles = files.filter((f) =>
      dirtySet.has(f.split(path.sep).join("/")),
    );

    const dirtyHashes = new Map<string, string>();
    if (dirtyFiles.length > 0) {
      await Promise.all(
        dirtyFiles.map(async (file) => {
          try {
            const out = await this.git.raw(["hash-object", file]);
            const sha = out.trim();
            if (sha) dirtyHashes.set(file, sha);
          } catch {
            // leave out of dirtyHashes — will fall back to tree SHA below
          }
        }),
      );
    }

    // Identify untracked files (not in HEAD tree, not dirty) and hash in parallel
    const untrackedFiles = files.filter((f) => {
      const normalized = f.split(path.sep).join("/");
      return !dirtySet.has(normalized) && !treeMap.has(normalized);
    });
    const untrackedHashes = new Map<string, string>();
    if (untrackedFiles.length > 0) {
      await Promise.all(
        untrackedFiles.map(async (file) => {
          try {
            const out = await this.git.raw(["hash-object", file]);
            const sha = out.trim();
            if (sha) untrackedHashes.set(file, sha);
          } catch {
            // ignore — file won't appear in result
          }
        }),
      );
    }

    // Main loop: pure map lookups + progress reporting (no subprocess spawns)
    for (const file of files) {
      const normalized = file.split(path.sep).join("/");
      const isDirty = dirtySet.has(normalized);
      const sha = isDirty
        ? dirtyHashes.get(file) ?? treeMap.get(normalized)
        : treeMap.get(normalized) ?? untrackedHashes.get(file);

      if (sha) {
        result.set(file, sha);
        this.logger.trace(`Revision for ${file}: ${sha.slice(0, 8)}`);
      }

      onProgress?.(++done, files.length);
    }

    return result;
  }

  async getChangedFilesSince(
    prevRevision: string,
    patterns?: string[],
  ): Promise<{
    added: string[];
    modified: string[];
    deleted: string[];
  } | null> {
    try {
      const args = [
        "diff",
        "--name-status",
        "--no-renames",
        `${prevRevision}..HEAD`,
      ];
      if (patterns && patterns.length > 0) {
        args.push("--", ...patterns);
      }
      const output = await this.git.raw(args);

      const added: string[] = [];
      const modified: string[] = [];
      const deleted: string[] = [];

      for (const line of output.trim().split("\n")) {
        if (!line) continue;
        const [status, filePath] = line.split("\t");
        if (!filePath) continue;
        if (status === "A") added.push(filePath);
        else if (status === "M") modified.push(filePath);
        else if (status === "D") deleted.push(filePath);
      }

      return {
        added: added.filter((f) => !this.isExcluded(f)),
        modified: modified.filter((f) => !this.isExcluded(f)),
        deleted: deleted.filter((f) => !this.isExcluded(f)),
      };
    } catch {
      return null;
    }
  }

  async getContext(): Promise<string> {
    try {
      const branch = await this.git.revparse(["--abbrev-ref", "HEAD"]);
      return branch.trim() || "HEAD";
    } catch {
      return "HEAD";
    }
  }

  async getPendingChanges(): Promise<Set<string>> {
    try {
      const status = await this.git.status();
      return new Set(
        status.files.map((f) => f.path).filter((p) => !this.isExcluded(p)),
      );
    } catch {
      return new Set();
    }
  }
}

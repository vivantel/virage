import { simpleGit, SimpleGit } from "simple-git";
import { minimatch } from "minimatch";
import path from "path";
import type { Logger } from "../interfaces/logger.js";
import { NullLogger } from "../logger/null-logger.js";
import type { SourceRepository } from "../interfaces/source-repository.js";
import type {
  SourceProvider,
  SourceItem,
  SourceFilter,
} from "../interfaces/source-provider.js";
import { CodeownersResolver } from "./label-pipeline.js";

export class CliGitSourceRepository
  implements SourceRepository, SourceProvider
{
  private readonly git: SimpleGit;
  private readonly logger: Logger;
  private readonly excludePatterns: string[];
  readonly rootUri: string;
  readonly name = "git";
  readonly type = "git";

  private _codeowners: CodeownersResolver | null | undefined = undefined;

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

  /** Returns the CODEOWNERS resolver for this repo (lazy-loaded, cached). */
  async getCodeownersResolver(): Promise<CodeownersResolver | null> {
    if (this._codeowners === undefined) {
      this._codeowners = await CodeownersResolver.fromDir(this.rootUri);
    }
    return this._codeowners;
  }

  /** Returns CODEOWNERS-derived labels for a file (relative path, forward slashes). */
  async getCodeownersLabels(filePath: string): Promise<string[]> {
    const resolver = await this.getCodeownersResolver();
    return resolver ? resolver.labelsForFile(filePath) : [];
  }

  /**
   * Enumerate all tracked files in HEAD as SourceItems.
   * Labels are pre-populated from CODEOWNERS for each file.
   */
  async *listAll(filter?: SourceFilter): AsyncIterable<SourceItem> {
    const codeowners = await this.getCodeownersResolver();

    // Get all tracked files via ls-tree
    let treeOutput: string;
    try {
      treeOutput = await this.git.raw([
        "ls-tree",
        "-r",
        "HEAD",
        "--format=%(objectname) %(path)",
      ]);
    } catch {
      return;
    }

    for (const line of treeOutput.trim().split("\n")) {
      if (!line) continue;
      const spaceIdx = line.indexOf(" ");
      if (spaceIdx < 0) continue;
      const blobSha = line.slice(0, spaceIdx);
      const filePath = line.slice(spaceIdx + 1);

      if (this.isExcluded(filePath)) continue;

      const normalized = filePath.split(path.sep).join("/");

      if (filter?.ignore?.some((p) => minimatch(normalized, p, { dot: true })))
        continue;
      if (
        filter?.include &&
        !filter.include.some((p) => minimatch(normalized, p, { dot: true }))
      )
        continue;

      const labels = codeowners ? codeowners.labelsForFile(normalized) : [];

      yield {
        id: blobSha,
        path: normalized,
        providerName: "git",
        labels,
        meta: { blobSha },
      };
    }
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
    // report progress as each hash resolves so the scanning bar animates.
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
          onProgress?.(++done, files.length);
        }),
      );
    }

    // Identify untracked files (not in HEAD tree, not dirty) and hash in parallel;
    // report progress as each hash resolves.
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
          onProgress?.(++done, files.length);
        }),
      );
    }

    // Main loop: pure map lookups for clean committed files + populate result.
    // Progress for dirty/untracked was already reported above; only count clean files here.
    const dirtyFileSet = new Set(dirtyFiles);
    const untrackedFileSet = new Set(untrackedFiles);
    for (const file of files) {
      const normalized = file.split(path.sep).join("/");
      const isDirty = dirtySet.has(normalized);
      const sha = isDirty
        ? (dirtyHashes.get(file) ?? treeMap.get(normalized))
        : (treeMap.get(normalized) ?? untrackedHashes.get(file));

      if (sha) {
        result.set(file, sha);
        this.logger.trace(`Revision for ${file}: ${sha.slice(0, 8)}`);
      }

      // Report progress for clean committed files (dirty/untracked already counted)
      if (!dirtyFileSet.has(file) && !untrackedFileSet.has(file)) {
        onProgress?.(++done, files.length);
      }
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

import { simpleGit, SimpleGit } from "simple-git";
import path from "path";
import type { Logger } from "../interfaces/logger.js";
import { NullLogger } from "../logger/null-logger.js";
import type { SourceRepository } from "../interfaces/source-repository.js";

export class CliGitSourceRepository implements SourceRepository {
  private readonly git: SimpleGit;
  private readonly logger: Logger;
  readonly rootUri: string;

  constructor(dir: string, logger?: Logger) {
    this.rootUri = dir;
    this.git = simpleGit(dir);
    this.logger = (logger ?? new NullLogger()).withTag("git");
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

    for (const file of files) {
      const normalized = file.split(path.sep).join("/");
      const isDirty = dirtySet.has(normalized);

      let sha: string | undefined;
      if (isDirty) {
        sha = dirtyHashes.get(file) ?? treeMap.get(normalized);
      } else {
        sha = treeMap.get(normalized);
      }

      // Untracked files not in HEAD tree: hash the file content
      if (!sha) {
        try {
          const out = await this.git.raw(["hash-object", file]);
          sha = out.trim() || undefined;
        } catch {
          // ignore — file won't appear in result
        }
      }

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

      return { added, modified, deleted };
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
      return new Set(status.files.map((f) => f.path));
    } catch {
      return new Set();
    }
  }
}

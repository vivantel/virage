import * as fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import git, { TREE } from "isomorphic-git";
import type { SourceRepository } from "@vivantel/virage-core";

function computeGitBlobSha(filePath: string): string {
  const content = fs.readFileSync(filePath);
  const header = `blob ${content.length}\0`;
  const hash = createHash("sha1");
  hash.update(header);
  hash.update(content);
  return hash.digest("hex");
}

export class IsomorphicGitSourceRepository implements SourceRepository {
  readonly rootUri: string;
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.rootUri = dir;
  }

  async getCurrentRevision(): Promise<string> {
    return git.resolveRef({ fs, dir: this.dir, ref: "HEAD" });
  }

  async getFileRevisions(
    files: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, string>> {
    if (files.length === 0) return new Map();

    const headSha = await git.resolveRef({ fs, dir: this.dir, ref: "HEAD" });

    // Walk HEAD tree once to build blob SHA map
    const treeMap = new Map<string, string>();
    await git.walk({
      fs,
      dir: this.dir,
      trees: [TREE({ ref: headSha })],
      map: async (filepath, [entry]) => {
        if (!entry) return;
        const type = await entry.type();
        if (type !== "blob") return;
        const oid = await entry.oid();
        treeMap.set(filepath, oid);
      },
    });

    // Get dirty files via statusMatrix
    const matrix = await git
      .statusMatrix({ fs, dir: this.dir })
      .catch(() => []);
    const dirtySet = new Set<string>();
    for (const [filepath, head, workdir] of matrix) {
      // workdir !== head means the working-tree copy differs from the tree
      if (workdir !== head) dirtySet.add(filepath as string);
    }

    const result = new Map<string, string>();
    let done = 0;

    for (const file of files) {
      const normalized = file.split(path.sep).join("/");
      const isDirty = dirtySet.has(normalized);
      const treeSha = treeMap.get(normalized);

      let sha: string | undefined;
      if (!isDirty && treeSha) {
        // Clean committed file: use blob SHA from HEAD tree (zero disk reads)
        sha = treeSha;
      } else {
        // Dirty or untracked: compute from actual file content
        try {
          sha = computeGitBlobSha(
            path.isAbsolute(file) ? file : path.join(this.dir, file),
          );
        } catch {
          // file unreadable — omit from result
        }
      }

      if (sha) result.set(file, sha);
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
      const headSha = await git.resolveRef({ fs, dir: this.dir, ref: "HEAD" });

      const added: string[] = [];
      const modified: string[] = [];
      const deleted: string[] = [];

      await git.walk({
        fs,
        dir: this.dir,
        trees: [TREE({ ref: headSha }), TREE({ ref: prevRevision })],
        map: async (filepath, [head, prev]) => {
          if (filepath === ".") return;

          // Skip directory entries
          if (head) {
            const type = await head.type();
            if (type === "tree") return;
          }
          if (prev) {
            const type = await prev.type();
            if (type === "tree") return;
          }

          // Apply pattern filter if provided
          if (patterns && patterns.length > 0) {
            const matches = patterns.some(
              (p) =>
                filepath.startsWith(p) ||
                filepath.endsWith(p) ||
                filepath.includes(p),
            );
            if (!matches) return;
          }

          const headOid = head ? await head.oid() : null;
          const prevOid = prev ? await prev.oid() : null;

          if (headOid === prevOid) return;

          if (!headOid && prevOid) {
            deleted.push(filepath);
          } else if (headOid && !prevOid) {
            added.push(filepath);
          } else {
            modified.push(filepath);
          }
        },
      });

      return { added, modified, deleted };
    } catch {
      return null;
    }
  }

  async getContext(): Promise<string> {
    try {
      return (await git.currentBranch({ fs, dir: this.dir })) ?? "HEAD";
    } catch {
      return "HEAD";
    }
  }

  async getPendingChanges(): Promise<Set<string>> {
    try {
      const matrix = await git.statusMatrix({ fs, dir: this.dir });
      const dirty = new Set<string>();
      for (const [filepath, head, workdir, stage] of matrix) {
        if (workdir !== head || stage !== head) {
          dirty.add(filepath as string);
        }
      }
      return dirty;
    } catch {
      return new Set();
    }
  }
}

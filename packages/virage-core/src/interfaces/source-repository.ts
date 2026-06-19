export interface SourceRepository {
  readonly rootUri: string;

  /**
   * An opaque revision identifier covering the whole source.
   * Git: HEAD commit SHA. S3: manifest hash or max version timestamp.
   * Changes whenever any file in the source changes.
   */
  getCurrentRevision(): Promise<string>;

  /**
   * A stable per-file content identifier.
   * CLI git: blob SHA (content-addressed, stable across rebases).
   * S3: ETag (content MD5). Local FS: SHA-256 of file bytes.
   * Changes when and only when file content changes.
   */
  getFileRevisions(
    files: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, string>>;

  /**
   * Files changed since a given revision.
   * `patterns` is an optional hint — implementations that support path
   * filtering use it; others return all changed files for the caller to filter.
   * Returns null when the revision is unknown → caller falls back to full scan.
   */
  getChangedFilesSince(
    prevRevision: string,
    patterns?: string[],
  ): Promise<{ added: string[]; modified: string[]; deleted: string[] } | null>;

  /**
   * Optional: a human-readable context label.
   * Git: current branch name. S3: bucket + prefix.
   */
  getContext?(): Promise<string>;

  /**
   * Optional: files modified but not yet "committed" to the source.
   * Git: uncommitted working-tree changes. S3 / local FS: return empty Set.
   */
  getPendingChanges?(): Promise<Set<string>>;
}

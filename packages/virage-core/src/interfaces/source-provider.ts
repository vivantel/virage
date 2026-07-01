import type { SourceRepository } from "./source-repository.js";

/**
 * A single addressable item produced by a SourceProvider.
 * Represents one file (or row, or blob) that will be sent to the chunking pipeline.
 */
export interface SourceItem {
  /** Stable unique ID within this provider (e.g. git blob SHA, S3 ETag, DB row PK). */
  id: string;

  /** Relative path from the source root — used by chunkers and for glob filtering. */
  path: string;

  /** Canonical name of the provider that produced this item (e.g. "git", "s3", "jdbc"). */
  providerName: string;

  /**
   * Labels attached to this item at discovery time, before chunk-level label rules run.
   * Examples: S3 object tags, CODEOWNERS team, space:confluence-space-key.
   */
  labels: string[];

  /** Provider-specific metadata (e.g. S3 ETag, DB row metadata, git commit hash). */
  meta?: Record<string, unknown>;
}

/**
 * Filter applied when listing items from a source provider.
 * All fields are optional; providers apply whichever they support.
 */
export interface SourceFilter {
  /** Only return items whose path matches at least one of these globs. */
  include?: string[];
  /** Exclude items whose path matches any of these globs. */
  ignore?: string[];
}

/**
 * Extended source interface that supports listing all available items.
 *
 * SourceProvider extends SourceRepository so all existing git-based implementations
 * satisfy the interface without changes. New providers (S3, JDBC, etc.) implement
 * this interface directly.
 *
 * The `name` and `type` fields identify the provider in logs and config.
 * `listAll()` returns an async iterable so large sources stream without buffering
 * all items in memory.
 */
export interface SourceProvider extends SourceRepository {
  /** Human-readable display name (e.g. "git", "s3:my-bucket/docs"). */
  readonly name: string;

  /** Provider type identifier — matches the key used in virage.config.json. */
  readonly type: string;

  /**
   * Enumerate all available items, applying optional filter.
   * Each item includes pre-computed labels from the provider
   * (e.g. S3 object tags, CODEOWNERS team).
   */
  listAll(filter?: SourceFilter): AsyncIterable<SourceItem>;
}

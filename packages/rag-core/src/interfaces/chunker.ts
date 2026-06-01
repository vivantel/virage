/**
 * Chunk interfaces - core building blocks for document processing
 */

import type { ChunkQualityMetrics } from "./quality.js";

export interface Chunk {
  /** The actual text content of the chunk */
  content: string;

  /** Metadata about this chunk (source file, type, etc.) */
  metadata: Record<string, unknown>;

  /** Original source file path */
  sourceFile: string;

  /** Git commit hash when this chunk was generated */
  commitHash: string;

  /** Optional unique hash of the content (for change detection) */
  contentHash?: string;
}

export interface FileChunker {
  /** Unique name of this chunker */
  name: string;

  /** Glob patterns this chunker handles */
  patterns: string[];

  /**
   * Process a file and return chunks.
   * Returns empty array if file should be skipped.
   */
  chunk(filePath: string, commitHash: string): Promise<Chunk[]>;

  /**
   * Optional: validate if this chunker can process the file
   * (called before chunk() to filter early)
   */
  canProcess?(filePath: string, content?: string): Promise<boolean>;
}

export interface ChunkStrategy {
  /** Strategy name */
  name: string;

  /** Split text into chunks according to strategy */
  chunk(text: string, filePath?: string): Promise<Chunk[]>;

  /** Optional: extract metadata without full chunking */
  extractMetadata?(text: string, filePath?: string): Record<string, unknown>;

  /** Optional: compute quality metrics for an already-generated set of chunks */
  getQualityMetrics?(chunks: Chunk[]): ChunkQualityMetrics;
}

export interface ChunkTransformer {
  /** Transformer name */
  name: string;

  /** Transform a chunk (return null to skip) */
  transform(chunk: Chunk): Promise<Chunk | null>;
}

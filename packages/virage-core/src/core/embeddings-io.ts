import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import {
  EmbeddedChunk,
  EmbeddingsFileFormat,
  EmbeddingsMeta,
} from "../interfaces/index.js";

export interface EmbeddingsReadResult {
  meta: EmbeddingsMeta | null;
  chunks: EmbeddedChunk[];
}

/**
 * Reads embeddings.json, handling both the legacy bare-array format (v1)
 * and the current wrapped format (v2+) with a _meta header.
 */
export async function readEmbeddingsFile(
  path: string,
): Promise<EmbeddingsReadResult> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return { meta: null, chunks: [] };
  }

  const parsed: unknown = JSON.parse(raw);

  // Legacy format: bare EmbeddedChunk[]
  if (Array.isArray(parsed)) {
    return { meta: null, chunks: parsed as EmbeddedChunk[] };
  }

  // Current format: { _meta, chunks }
  const file = parsed as EmbeddingsFileFormat;
  return { meta: file._meta ?? null, chunks: file.chunks ?? [] };
}

export async function writeEmbeddingsFile(
  path: string,
  meta: EmbeddingsMeta,
  chunks: EmbeddedChunk[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const file: EmbeddingsFileFormat = { _meta: meta, chunks };
  await writeFile(path, JSON.stringify(file, null, 2), "utf-8");
}

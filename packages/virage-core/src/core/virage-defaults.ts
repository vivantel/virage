export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".next",
  "out",
  ".turbo",
]);

export function getVirageDir(): string {
  return process.env["VIRAGE_DIR"] ?? ".virage";
}

export function defaultChunksFile(): string {
  return `${getVirageDir()}/chunks.json`;
}

export function defaultEmbeddingsFile(): string {
  return `${getVirageDir()}/embeddings.json`;
}

export function defaultEmbeddingsDb(): string {
  return `${getVirageDir()}/embeddings.db`;
}

export function getVirageDir(): string {
  return process.env["VIRAGE_DIR"] ?? ".virage";
}

export function defaultChunksFile(): string {
  return `${getVirageDir()}/chunks.json`;
}

export function defaultEmbeddingsFile(): string {
  return `${getVirageDir()}/embeddings.json`;
}

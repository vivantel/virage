import { ConfigError } from "./core/errors.js";

export const BUILTIN_TO_PACKAGE: Record<string, string> = {
  // chunkers
  md: "@vivantel/virage-chunker-ce-md",
  pdf: "@vivantel/virage-chunker-ce-pdf",
  docx: "@vivantel/virage-chunker-ce-docx",
  latex: "@vivantel/virage-chunker-ce-latex",
  lang: "@vivantel/virage-chunker-ce-lang",
  // embedders
  fastembed: "@vivantel/virage-embedder-fastembed",
  onnx: "@vivantel/virage-embedder-onnx",
  // vector stores
  lancedb: "@vivantel/virage-store-lancedb",
  qdrant: "@vivantel/virage-store-qdrant",
  postgres: "@vivantel/virage-store-postgres",
  chromadb: "@vivantel/virage-store-chromadb",
  // sources
  git: "@vivantel/virage-source-git",
  localfs: "@vivantel/virage-source-localfs",
  // rerankers
  "cross-encoder": "@vivantel/virage-reranker-cross-encoder",
  llm: "@vivantel/virage-reranker-llm",
};

export const PACKAGE_TO_BUILTIN: Record<string, string> = Object.fromEntries(
  Object.entries(BUILTIN_TO_PACKAGE).map(([k, v]) => [v, k]),
);

export function resolvePackageName(ref: {
  package?: string;
  builtin?: string;
}): string {
  if (ref.builtin !== undefined) {
    const pkg = BUILTIN_TO_PACKAGE[ref.builtin];
    if (!pkg)
      throw new ConfigError(`Unknown builtin key: "${ref.builtin}"`, {
        suggestion: `Valid builtin keys: ${Object.keys(BUILTIN_TO_PACKAGE).join(", ")}`,
      });
    return pkg;
  }
  if (!ref.package)
    throw new ConfigError(
      "Plugin ref must have either a 'package' name or a 'builtin' key",
    );
  return ref.package;
}

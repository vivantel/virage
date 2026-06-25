export interface RagPlugin {
  name: string;
  type: "embedder" | "store" | "chunker";
  factory: () => unknown;
}

/**
 * Discover RAG plugins from installed npm packages.
 *
 * A plugin package must export either:
 *   `ragPlugin: RagPlugin`   — single plugin
 *   `ragPlugins: RagPlugin[]` — multiple plugins
 *
 * Naming convention (not enforced):
 *   rag-embedder-*   EmbeddingProvider implementations
 *   rag-store-*      VectorStore implementations
 *   rag-chunker-*    FileChunker implementations
 */
export async function discoverPlugins(
  packageNames: string[],
): Promise<RagPlugin[]> {
  const discovered: RagPlugin[] = [];

  for (const pkg of packageNames) {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(pkg)) as Record<string, unknown>;
    } catch {
      console.warn(`  ⚠️ Could not load plugin package: ${pkg}`);
      continue;
    }

    if (isRagPlugin(mod.ragPlugin)) {
      discovered.push(mod.ragPlugin);
    } else if (Array.isArray(mod.ragPlugins)) {
      for (const p of mod.ragPlugins) {
        if (isRagPlugin(p)) discovered.push(p);
      }
    } else {
      console.warn(
        `  ⚠️ Package "${pkg}" has no ragPlugin or ragPlugins export — skipping`,
      );
    }
  }

  return discovered;
}

function isRagPlugin(value: unknown): value is RagPlugin {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.name === "string" &&
    (p.type === "embedder" || p.type === "store" || p.type === "chunker") &&
    typeof p.factory === "function"
  );
}

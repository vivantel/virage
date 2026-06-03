import { readFile } from "fs/promises";
import { join } from "path";

export type PluginType = "embedder" | "vectorStore";

export interface PluginEntry {
  type: PluginType;
  label: string;
  key: string;
  package: string;
  envVars: string[];
  defaultConfig: Record<string, unknown>;
}

export const BUILT_IN_PLUGINS: PluginEntry[] = [
  // ── Embedders ──
  {
    type: "embedder",
    label: "OpenAI (text-embedding-3-small)",
    key: "openai",
    package: "@vivantel/virage-embedder-openai",
    envVars: ["OPENAI_API_KEY"],
    defaultConfig: {
      apiKey: "${OPENAI_API_KEY}",
      model: "text-embedding-3-small",
      dimensions: 1536,
    },
  },
  {
    type: "embedder",
    label: "FastEmbed (local, no API key required)",
    key: "fastembed",
    package: "@vivantel/virage-embedder-fastembed",
    envVars: [],
    defaultConfig: {
      model: "BAAI/bge-small-en-v1.5",
      dimensions: 384,
    },
  },
  {
    type: "embedder",
    label: "HuggingFace Transformers (local, no API key required)",
    key: "transformers",
    package: "@vivantel/virage-embedder-transformers",
    envVars: [],
    defaultConfig: {
      model: "Xenova/all-MiniLM-L6-v2",
      dimensions: 384,
    },
  },
  {
    type: "embedder",
    label: "Custom (implement the EmbeddingProvider interface yourself)",
    key: "custom",
    package: "@your-org/rag-embedder-custom",
    envVars: [],
    defaultConfig: {
      apiKey: "${YOUR_API_KEY}",
      model: "your-model-name",
      dimensions: 1536,
    },
  },
  // ── Vector Stores ──
  {
    type: "vectorStore",
    label: "PostgreSQL / pgvector (@vivantel/virage-store-postgres)",
    key: "postgres",
    package: "@vivantel/virage-store-postgres",
    envVars: ["DATABASE_URL"],
    defaultConfig: { connectionString: "${DATABASE_URL}" },
  },
  {
    type: "vectorStore",
    label: "Qdrant (local Docker or Cloud)",
    key: "qdrant",
    package: "@vivantel/virage-store-qdrant",
    envVars: [],
    defaultConfig: {
      url: "${QDRANT_URL}",
      apiKey: "${QDRANT_API_KEY}",
    },
  },
  {
    type: "vectorStore",
    label: "LanceDB (embedded, file-based — no server needed)",
    key: "lancedb",
    package: "@vivantel/virage-store-lancedb",
    envVars: [],
    defaultConfig: { uri: ".virage/lancedb" },
  },
  {
    type: "vectorStore",
    label: "ChromaDB (local or hosted)",
    key: "chromadb",
    package: "@vivantel/virage-store-chromadb",
    envVars: [],
    defaultConfig: { path: "http://localhost:8000" },
  },
  {
    type: "vectorStore",
    label: "Custom (implement the VectorStore interface yourself)",
    key: "custom",
    package: "@your-org/rag-store-custom",
    envVars: [],
    defaultConfig: {},
  },
];

export async function discoverExternalPlugins(
  projectRoot: string,
): Promise<PluginEntry[]> {
  let pkgJson: Record<string, unknown>;
  try {
    const content = await readFile(join(projectRoot, "package.json"), "utf-8");
    pkgJson = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return [];
  }

  const deps: Record<string, string> = {
    ...((pkgJson.dependencies as Record<string, string> | undefined) ?? {}),
    ...((pkgJson.devDependencies as Record<string, string> | undefined) ?? {}),
  };

  const entries: PluginEntry[] = [];

  for (const depName of Object.keys(deps)) {
    try {
      const depPkgPath = join(
        projectRoot,
        "node_modules",
        depName,
        "package.json",
      );
      const depContent = await readFile(depPkgPath, "utf-8");
      const depPkg = JSON.parse(depContent) as Record<string, unknown>;

      const ragPlugin = depPkg["rag-plugin"];
      if (
        !ragPlugin ||
        typeof ragPlugin !== "object" ||
        Array.isArray(ragPlugin)
      )
        continue;

      const plugin = ragPlugin as Record<string, unknown>;
      const { type, label, key } = plugin;

      if (
        (type !== "embedder" && type !== "vectorStore") ||
        typeof label !== "string" ||
        typeof key !== "string"
      )
        continue;

      entries.push({
        type: type as PluginType,
        label,
        key,
        package: depName,
        envVars: Array.isArray(plugin.envVars)
          ? plugin.envVars.filter((v): v is string => typeof v === "string")
          : [],
        defaultConfig:
          typeof plugin.defaultConfig === "object" &&
          plugin.defaultConfig !== null &&
          !Array.isArray(plugin.defaultConfig)
            ? (plugin.defaultConfig as Record<string, unknown>)
            : {},
      });
    } catch {
      // skip packages without valid rag-plugin field
    }
  }

  return entries;
}

export interface PluginRegistry {
  embedders: PluginEntry[];
  stores: PluginEntry[];
}

export async function loadRegistry(
  projectRoot: string,
): Promise<PluginRegistry> {
  const external = await discoverExternalPlugins(projectRoot);

  const merged = new Map<string, PluginEntry>();
  for (const entry of BUILT_IN_PLUGINS) {
    merged.set(`${entry.type}:${entry.key}`, entry);
  }
  for (const entry of external) {
    merged.set(`${entry.type}:${entry.key}`, entry);
  }

  const all = Array.from(merged.values());
  return {
    embedders: all.filter((e) => e.type === "embedder"),
    stores: all.filter((e) => e.type === "vectorStore"),
  };
}

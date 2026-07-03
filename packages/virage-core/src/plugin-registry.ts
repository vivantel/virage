import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export type PluginType = "embedder" | "vectorStore" | "source";

export interface PluginEntry {
  type: PluginType;
  label: string;
  key: string;
  package: string;
  envVars: string[];
  defaultConfig: Record<string, unknown>;
}

export const BUILT_IN_PLUGINS: PluginEntry[] = [
  // ── Source repositories ──
  {
    type: "source",
    label: "Git CLI (default, uses local git binary)",
    key: "cli-git",
    package: "@vivantel/virage-core",
    envVars: [],
    defaultConfig: {},
  },
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
    label: "ONNX Runtime (local, Rust — no API key required)",
    key: "onnx",
    package: "@vivantel/virage-embedder-onnx",
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

async function scanDirForRagPlugins(
  nodeModulesDir: string,
): Promise<PluginEntry[]> {
  const entries: PluginEntry[] = [];
  if (!existsSync(nodeModulesDir)) return entries;

  async function tryEntry(pkgDir: string, pkgName: string): Promise<void> {
    try {
      const content = await readFile(join(pkgDir, "package.json"), "utf-8");
      const depPkg = JSON.parse(content) as Record<string, unknown>;
      const ragPlugin = depPkg["rag-plugin"];
      if (
        !ragPlugin ||
        typeof ragPlugin !== "object" ||
        Array.isArray(ragPlugin)
      )
        return;
      const plugin = ragPlugin as Record<string, unknown>;
      const { type, label, key } = plugin;
      if (
        (type !== "embedder" && type !== "vectorStore" && type !== "source") ||
        typeof label !== "string" ||
        typeof key !== "string"
      )
        return;
      entries.push({
        type: type as PluginType,
        label,
        key,
        package: pkgName,
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
      // skip
    }
  }

  try {
    const top = await readdir(nodeModulesDir, { withFileTypes: true });
    for (const entry of top) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith("@")) {
        const scopeDir = join(nodeModulesDir, entry.name);
        try {
          const scoped = await readdir(scopeDir, { withFileTypes: true });
          for (const s of scoped) {
            if (!s.isDirectory() && !s.isSymbolicLink()) continue;
            const pkgName = `${entry.name}/${s.name}`;
            await tryEntry(join(scopeDir, s.name), pkgName);
          }
        } catch {
          // skip
        }
      } else {
        await tryEntry(join(nodeModulesDir, entry.name), entry.name);
      }
    }
  } catch {
    // dir unreadable
  }

  return entries;
}

export async function discoverExternalPlugins(
  projectRoot: string,
): Promise<PluginEntry[]> {
  const localPluginModules = join(
    projectRoot,
    ".virage",
    "plugins",
    "node_modules",
  );
  const globalPluginModules = join(
    homedir(),
    ".virage",
    "plugins",
    "node_modules",
  );

  const [localEntries, globalEntries, nodeModulesEntries] = await Promise.all([
    scanDirForRagPlugins(localPluginModules),
    scanDirForRagPlugins(globalPluginModules),
    // Backwards compat: also scan project node_modules
    (async (): Promise<PluginEntry[]> => {
      let pkgJson: Record<string, unknown>;
      try {
        const content = await readFile(
          join(projectRoot, "package.json"),
          "utf-8",
        );
        pkgJson = JSON.parse(content) as Record<string, unknown>;
      } catch {
        return [];
      }
      const deps: Record<string, string> = {
        ...((pkgJson.dependencies as Record<string, string> | undefined) ?? {}),
        ...((pkgJson.devDependencies as Record<string, string> | undefined) ??
          {}),
      };
      return scanDirForRagPlugins(join(projectRoot, "node_modules")).then(
        (all) => all.filter((e) => deps[e.package] !== undefined),
      );
    })(),
  ]);

  // Merge: local wins over global wins over node_modules
  const merged = new Map<string, PluginEntry>();
  for (const e of nodeModulesEntries) merged.set(`${e.type}:${e.key}`, e);
  for (const e of globalEntries) merged.set(`${e.type}:${e.key}`, e);
  for (const e of localEntries) merged.set(`${e.type}:${e.key}`, e);
  return Array.from(merged.values());
}

export interface PluginRegistry {
  embedders: PluginEntry[];
  stores: PluginEntry[];
  sources: PluginEntry[];
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
    sources: all.filter((e) => e.type === "source"),
  };
}

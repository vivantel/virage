import { checkbox, select, input } from "@inquirer/prompts";
import { writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { readdir } from "fs/promises";
import { join, extname } from "path";

// ─── File type detection ──────────────────────────────────────────────────────

interface ExtGroup {
  exts: string[];
  strategyFn: string;
  name: string;
}

const EXT_GROUPS: ExtGroup[] = [
  {
    exts: [".md", ".mdx"],
    strategyFn: "markdownHeadersStrategy",
    name: "markdown",
  },
  { exts: [".ts", ".tsx"], strategyFn: "tokenStrategy", name: "typescript" },
  { exts: [".js", ".jsx"], strategyFn: "tokenStrategy", name: "javascript" },
  { exts: [".py"], strategyFn: "tokenStrategy", name: "python" },
  { exts: [".go"], strategyFn: "tokenStrategy", name: "go" },
  { exts: [".cs"], strategyFn: "tokenStrategy", name: "csharp" },
  { exts: [".java"], strategyFn: "tokenStrategy", name: "java" },
  { exts: [".yaml", ".yml"], strategyFn: "wholeFileStrategy", name: "yaml" },
  { exts: [".txt"], strategyFn: "semanticStrategy", name: "text" },
];

const IGNORED_DIRS = new Set([
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

async function collectExtensions(
  dir: string,
  found: Set<string>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await collectExtensions(join(dir, entry.name), found);
      }
    } else {
      const ext = extname(entry.name).toLowerCase();
      if (ext) found.add(ext);
    }
  }
}

export async function detectFileExtensions(cwd: string): Promise<ExtGroup[]> {
  const found = new Set<string>();
  await collectExtensions(cwd, found);
  return EXT_GROUPS.filter((g) => g.exts.some((e) => found.has(e)));
}

// ─── Back-navigation support ──────────────────────────────────────────────────

const BACK_VALUE = "__back__";

/** Inject a "← Back" option into a select choices list. */
function withBack<T>(
  choices: { name: string; value: T }[],
): { name: string; value: T | typeof BACK_VALUE }[] {
  return [
    { name: "← Back", value: BACK_VALUE as typeof BACK_VALUE },
    ...choices,
  ];
}

function isBack(value: unknown): value is typeof BACK_VALUE {
  return value === BACK_VALUE;
}

// ─── Wizard state ─────────────────────────────────────────────────────────────

interface WizardState {
  groups: ExtGroup[];
  embedder: string;
  vectorStore: string;
  outputPath: string;
}

// ─── Embedder / vector store metadata ────────────────────────────────────────

interface EmbedderMeta {
  label: string;
  key: string;
  envVars: string[];
}

interface StoreMeta {
  label: string;
  key: string;
  envVars: string[];
}

const EMBEDDERS: EmbedderMeta[] = [
  {
    label: "OpenAI (text-embedding-3-small)",
    key: "openai",
    envVars: ["OPENAI_API_KEY"],
  },
  {
    label: "GitHub Models (Azure-compatible endpoint)",
    key: "github-models",
    envVars: ["GITHUB_TOKEN"],
  },
  {
    label: "FastEmbed (local, no API key required)",
    key: "fastembed",
    envVars: [],
  },
  {
    label: "HuggingFace Transformers (local, no API key required)",
    key: "transformers",
    envVars: [],
  },
  {
    label: "Custom (implement the EmbeddingProvider interface yourself)",
    key: "custom",
    envVars: [],
  },
];

const STORES: StoreMeta[] = [
  {
    label: "PostgreSQL / pgvector (@vivantel/rag-store-postgres)",
    key: "postgres",
    envVars: ["DATABASE_URL"],
  },
  {
    label: "Qdrant — local instance (http://localhost:6333)",
    key: "qdrant-local",
    envVars: [],
  },
  {
    label: "Qdrant — local file (data stored in a directory on disk)",
    key: "qdrant-file",
    envVars: [],
  },
  {
    label: "Qdrant Cloud (@vivantel/rag-store-qdrant)",
    key: "qdrant-cloud",
    envVars: ["QDRANT_URL", "QDRANT_API_KEY"],
  },
  {
    label: "Custom (implement the VectorStore interface yourself)",
    key: "custom",
    envVars: [],
  },
];

// ─── Config generation ────────────────────────────────────────────────────────

const STRATEGY_FN_TO_JSON: Record<string, string> = {
  markdownHeadersStrategy: "markdownHeaders",
  tokenStrategy: "token",
  wholeFileStrategy: "wholeFile",
  semanticStrategy: "semantic",
};

function generateJsonConfig(state: WizardState): string {
  const effectiveGroups =
    state.groups.length > 0
      ? state.groups
      : [EXT_GROUPS.find((g) => g.name === "typescript")!];

  const chunkers = effectiveGroups.map((g) => {
    const strategyName = STRATEGY_FN_TO_JSON[g.strategyFn] ?? g.strategyFn;
    return {
      name: g.name,
      patterns: g.exts.map((e) => `**/*${e}`),
      strategy: strategyName,
    };
  });

  let embedderPackage: string;
  let embedderConfig: Record<string, unknown>;
  switch (state.embedder) {
    case "openai":
      embedderPackage = "@vivantel/rag-embedder-openai";
      embedderConfig = {
        apiKey: "${OPENAI_API_KEY}",
        model: "text-embedding-3-small",
        dimensions: 1536,
      };
      break;
    case "github-models":
      embedderPackage = "@vivantel/rag-embedder-openai";
      embedderConfig = {
        apiKey: "${GITHUB_TOKEN}",
        baseURL: "https://models.github.ai/inference",
        model: "openai/text-embedding-3-small",
        dimensions: 1536,
      };
      break;
    case "fastembed":
      embedderPackage = "@vivantel/rag-embedder-fastembed";
      embedderConfig = {
        model: "BAAI/bge-small-en-v1.5",
        dimensions: 384,
      };
      break;
    case "transformers":
      embedderPackage = "@vivantel/rag-embedder-transformers";
      embedderConfig = {
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
      };
      break;
    default:
      embedderPackage = "@your-org/rag-embedder-custom";
      embedderConfig = {
        apiKey: "${YOUR_API_KEY}",
        model: "your-model-name",
        dimensions: 1536,
      };
  }

  let vectorStorePackage: string;
  let vectorStoreConfig: Record<string, unknown>;
  switch (state.vectorStore) {
    case "postgres":
      vectorStorePackage = "@vivantel/rag-store-postgres";
      vectorStoreConfig = { connectionString: "${DATABASE_URL}" };
      break;
    case "qdrant-local":
      vectorStorePackage = "@vivantel/rag-store-qdrant";
      vectorStoreConfig = { url: "http://localhost:6333" };
      break;
    case "qdrant-file":
      vectorStorePackage = "@vivantel/rag-store-qdrant";
      vectorStoreConfig = { path: "./qdrant-storage" };
      break;
    case "qdrant-cloud":
      vectorStorePackage = "@vivantel/rag-store-qdrant";
      vectorStoreConfig = {
        url: "${QDRANT_URL}",
        apiKey: "${QDRANT_API_KEY}",
      };
      break;
    default:
      vectorStorePackage = "@your-org/rag-store-custom";
      vectorStoreConfig = {};
  }

  const config = {
    $schema: "./node_modules/@vivantel/rag-core/schemas/rag.config.schema.json",
    chunkers,
    embedder: { package: embedderPackage, config: embedderConfig },
    vectorStore: { package: vectorStorePackage, config: vectorStoreConfig },
    options: {
      chunksFile: "./docs/rag/chunks.json",
      embeddingsFile: "./docs/rag/embeddings.json",
    },
  };

  return JSON.stringify(config, null, 2) + "\n";
}

// ─── .env writing ─────────────────────────────────────────────────────────────

async function writeEnvVars(
  envPath: string,
  vars: Record<string, string>,
): Promise<{ written: string[]; skipped: string[] }> {
  let existing = "";
  if (existsSync(envPath)) {
    existing = await readFile(envPath, "utf-8");
  }

  const written: string[] = [];
  const skipped: string[] = [];
  const lines: string[] = existing.endsWith("\n")
    ? [existing]
    : existing
      ? [existing, ""]
      : [];

  for (const [key, value] of Object.entries(vars)) {
    const alreadyDefined = existing
      .split("\n")
      .some(
        (line) => line.startsWith(`${key}=`) || line.startsWith(`${key} =`),
      );

    if (alreadyDefined) {
      skipped.push(key);
    } else {
      lines.push(`${key}=${value}`);
      written.push(key);
    }
  }

  if (written.length > 0) {
    await writeFile(envPath, lines.join("\n").trimStart() + "\n", "utf-8");
  }

  return { written, skipped };
}

// ─── Install hint ─────────────────────────────────────────────────────────────

function installHint(state: WizardState): string {
  const pkgs: string[] = [];
  switch (state.embedder) {
    case "openai":
    case "github-models":
      pkgs.push("@vivantel/rag-embedder-openai");
      break;
    case "fastembed":
      pkgs.push("@vivantel/rag-embedder-fastembed");
      break;
    case "transformers":
      pkgs.push("@vivantel/rag-embedder-transformers");
      break;
  }
  switch (state.vectorStore) {
    case "postgres":
      pkgs.push("@vivantel/rag-store-postgres");
      break;
    case "qdrant-local":
    case "qdrant-file":
    case "qdrant-cloud":
      pkgs.push("@vivantel/rag-store-qdrant");
      break;
  }
  return pkgs.length > 0
    ? `  npm install ${pkgs.join(" ")}`
    : "  (no additional packages needed)";
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export async function runInit(): Promise<void> {
  console.log("\nRAG Config Generator\n");

  console.log("Scanning project for file types...");
  const detectedGroups = await detectFileExtensions(process.cwd());

  const state: Partial<WizardState> = {};
  let step = 0;

  while (step < 4) {
    switch (step) {
      // ── Step 0: chunker selection ──
      case 0: {
        if (detectedGroups.length > 0) {
          const confirmed = await checkbox({
            message: "Detected file types — select which to index:",
            choices: [
              { name: "← Back (cancel init)", value: "__back__" },
              ...detectedGroups.map((g) => ({
                name: `${g.name} (${g.exts.join(", ")}) → ${g.strategyFn}`,
                value: g.name,
                checked: true,
              })),
            ],
          });
          if (confirmed.includes("__back__")) {
            console.log("\nCancelled.");
            return;
          }
          state.groups = detectedGroups.filter((g) =>
            confirmed.includes(g.name),
          );
        } else {
          console.log(
            "No known file types detected. Choose strategies manually:",
          );
          const chosen = await checkbox({
            message: "Which chunking strategies do you need?",
            choices: [
              { name: "← Back (cancel init)", value: "__back__" },
              ...EXT_GROUPS.map((g) => ({
                name: `${g.name} (${g.strategyFn})`,
                value: g.name,
              })),
            ],
          });
          if (chosen.includes("__back__")) {
            console.log("\nCancelled.");
            return;
          }
          state.groups = EXT_GROUPS.filter((g) => chosen.includes(g.name));
        }
        step++;
        break;
      }

      // ── Step 1: embedder selection ──
      case 1: {
        const choice = await select({
          message: "Which embedding provider?",
          choices: withBack(
            EMBEDDERS.map((e) => ({ name: e.label, value: e.key })),
          ),
        });
        if (isBack(choice)) {
          step--;
          break;
        }
        state.embedder = choice;
        step++;
        break;
      }

      // ── Step 2: vector store selection ──
      case 2: {
        const choice = await select({
          message: "Which vector store?",
          choices: withBack(
            STORES.map((s) => ({ name: s.label, value: s.key })),
          ),
        });
        if (isBack(choice)) {
          step--;
          break;
        }
        state.vectorStore = choice;
        step++;
        break;
      }

      // ── Step 3: output path ──
      case 3: {
        const defaultOutput = "./rag.config.json";
        const outputPath = await input({
          message: "Output path for the config file? (leave blank to go back)",
          default: defaultOutput,
        });
        if (outputPath.trim() === "") {
          step--;
          break;
        }
        state.outputPath = outputPath.trim();
        step++;
        break;
      }
    }
  }

  const finalState = state as WizardState;

  // ── Overwrite check ──
  if (existsSync(finalState.outputPath)) {
    const overwrite = await select({
      message: `${finalState.outputPath} already exists. Overwrite?`,
      choices: [
        { name: "Yes, overwrite", value: "yes" },
        { name: "No, cancel", value: "no" },
      ],
    });
    if (overwrite === "no") {
      console.log("\nCancelled.");
      return;
    }
  }

  // ── Write config ──
  const configContent = generateJsonConfig(finalState);
  await writeFile(finalState.outputPath, configContent, "utf-8");
  console.log(`\nCreated ${finalState.outputPath}`);

  // ── Secrets step ──
  const embedderMeta = EMBEDDERS.find((e) => e.key === finalState.embedder);
  const storeMeta = STORES.find((s) => s.key === finalState.vectorStore);
  const requiredVars = [
    ...(embedderMeta?.envVars ?? []),
    ...(storeMeta?.envVars ?? []),
  ];

  if (requiredVars.length > 0) {
    console.log("\nThis configuration requires the following secrets:");
    const envValues: Record<string, string> = {};

    for (const varName of requiredVars) {
      const value = await input({
        message: `Enter value for ${varName} (leave blank to skip):`,
        default: "",
      });
      if (value.trim()) {
        envValues[varName] = value.trim();
      }
    }

    if (Object.keys(envValues).length > 0) {
      const envPath = "./.env";
      const { written, skipped } = await writeEnvVars(envPath, envValues);
      if (written.length > 0) {
        console.log(`\nWrote to ${envPath}: ${written.join(", ")}`);
      }
      if (skipped.length > 0) {
        console.log(`Already defined (skipped): ${skipped.join(", ")}`);
      }
    } else {
      console.log(
        "\nNo secrets entered — add them to your .env file manually.",
      );
    }
  } else {
    console.log("\nNo secrets required for this combination.");
  }

  // ── Next steps ──
  console.log("\nNext steps:");
  console.log(`  1. Install packages:\n${installHint(finalState)}`);
  if (finalState.vectorStore === "qdrant-file") {
    console.log(
      "  2. Start Qdrant with your storage directory:\n" +
        "       docker run -v $(pwd)/qdrant-storage:/qdrant/storage \\\n" +
        "                  -p 6333:6333 qdrant/qdrant",
    );
    console.log("  3. Run `rag-update validate` to check the config");
    console.log("  4. Run `rag-update` to start indexing\n");
  } else {
    console.log("  2. Run `rag-update validate` to check the config");
    console.log("  3. Run `rag-update` to start indexing\n");
  }
}

import { checkbox, confirm, input, select } from "@inquirer/prompts";
import { existsSync } from "fs";
import { readFile, readdir, writeFile } from "fs/promises";
import { extname, join } from "path";
import { spawn } from "child_process";
import { loadRegistry, type PluginRegistry } from "../plugin-registry.js";

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

// ─── Package helpers ──────────────────────────────────────────────────────────

function getRequiredPackages(
  state: WizardState,
  registry: PluginRegistry,
): string[] {
  const embedderEntry = registry.embedders.find(
    (e) => e.key === state.embedder,
  );
  const storeEntry = registry.stores.find((s) => s.key === state.vectorStore);
  const pkgs = new Set<string>();
  if (embedderEntry && embedderEntry.key !== "custom")
    pkgs.add(embedderEntry.package);
  if (storeEntry && storeEntry.key !== "custom") pkgs.add(storeEntry.package);
  return Array.from(pkgs);
}

async function detectPackageManager(
  projectRoot: string,
): Promise<"npm" | "yarn" | "pnpm" | "bun"> {
  if (existsSync(join(projectRoot, "bun.lockb"))) return "bun";
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectRoot, "yarn.lock"))) return "yarn";
  return "npm";
}

function buildInstallCommand(
  pm: "npm" | "yarn" | "pnpm" | "bun",
  packages: string[],
): { cmd: string; args: string[] } {
  switch (pm) {
    case "yarn":
      return { cmd: "yarn", args: ["add", ...packages] };
    case "pnpm":
      return { cmd: "pnpm", args: ["add", ...packages] };
    case "bun":
      return { cmd: "bun", args: ["add", ...packages] };
    default:
      return { cmd: "npm", args: ["install", ...packages] };
  }
}

function runInstall(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Install failed with exit code ${code}`)),
    );
    proc.on("error", reject);
  });
}

// ─── Config generation ────────────────────────────────────────────────────────

const STRATEGY_FN_TO_JSON: Record<string, string> = {
  markdownHeadersStrategy: "markdownHeaders",
  tokenStrategy: "token",
  wholeFileStrategy: "wholeFile",
  semanticStrategy: "semantic",
};

function generateJsonConfig(
  state: WizardState,
  registry: PluginRegistry,
): string {
  const effectiveGroups =
    state.groups.length > 0
      ? state.groups
      : [EXT_GROUPS.find((g) => g.name === "typescript")!];

  const chunkers = effectiveGroups.map((g) => ({
    name: g.name,
    patterns: g.exts.map((e) => `**/*${e}`),
    strategy: STRATEGY_FN_TO_JSON[g.strategyFn] ?? g.strategyFn,
  }));

  const embedderEntry = registry.embedders.find(
    (e) => e.key === state.embedder,
  )!;
  const storeEntry = registry.stores.find((s) => s.key === state.vectorStore)!;

  const config = {
    $schema: "./node_modules/@vivantel/rag-core/schemas/rag.config.schema.json",
    chunkers,
    embedder: {
      package: embedderEntry.package,
      config: embedderEntry.defaultConfig,
    },
    vectorStore: {
      package: storeEntry.package,
      config: storeEntry.defaultConfig,
    },
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

// ─── Main wizard ──────────────────────────────────────────────────────────────

export async function runInit(): Promise<void> {
  console.log("\nRAG Config Generator\n");

  const cwd = process.cwd();
  console.log("Scanning project for file types...");
  const detectedGroups = await detectFileExtensions(cwd);

  const registry = await loadRegistry(cwd);

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
              ...detectedGroups.map((g) => ({
                name: `${g.name} (${g.exts.join(", ")}) → ${g.strategyFn}`,
                value: g.name,
                checked: true,
              })),
              { name: "← Back (cancel init)", value: "__back__" },
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
              ...EXT_GROUPS.map((g) => ({
                name: `${g.name} (${g.strategyFn})`,
                value: g.name,
              })),
              { name: "← Back (cancel init)", value: "__back__" },
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
            registry.embedders.map((e) => ({ name: e.label, value: e.key })),
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
            registry.stores.map((s) => ({ name: s.label, value: s.key })),
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
  const configContent = generateJsonConfig(finalState, registry);
  await writeFile(finalState.outputPath, configContent, "utf-8");
  console.log(`\nCreated ${finalState.outputPath}`);

  // ── Secrets step ──
  const embedderEntry = registry.embedders.find(
    (e) => e.key === finalState.embedder,
  );
  const storeEntry = registry.stores.find(
    (s) => s.key === finalState.vectorStore,
  );
  const requiredVars = [
    ...(embedderEntry?.envVars ?? []),
    ...(storeEntry?.envVars ?? []),
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

  // ── Auto-install ──
  const pkgs = getRequiredPackages(finalState, registry);
  if (pkgs.length > 0) {
    const pm = await detectPackageManager(cwd);
    const { cmd, args } = buildInstallCommand(pm, pkgs);
    const shouldInstall = await confirm({
      message: `Install ${pkgs.join(" ")} now? [using ${pm}]`,
      default: true,
    });
    if (shouldInstall) {
      try {
        await runInstall(cmd, args);
        console.log("\nPackages installed successfully.");
      } catch {
        console.log(
          `\nInstall failed. Run manually:\n  ${cmd} ${args.join(" ")}`,
        );
      }
    } else {
      console.log(`\nRun manually:\n  ${cmd} ${args.join(" ")}`);
    }
  }

  // ── Next steps ──
  console.log("\nNext steps:");
  let nextStep = 1;
  if (finalState.vectorStore === "qdrant") {
    console.log(
      `  ${nextStep++}. Qdrant local: docker run -p 6333:6333 qdrant/qdrant`,
    );
    console.log(
      `     Set QDRANT_URL=http://localhost:6333 (local) or your cluster URL (cloud).`,
    );
  }
  console.log(
    `  ${nextStep++}. Run \`rag-update validate\` to check the config`,
  );
  console.log(`  ${nextStep}. Run \`rag-update\` to start indexing\n`);
}

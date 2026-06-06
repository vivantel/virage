import { checkbox, input, select } from "@inquirer/prompts";
import { existsSync } from "fs";
import { readFile, rename, writeFile } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";
import { loadRegistry, getVirageDir } from "@vivantel/virage-core";
import type { PluginRegistry } from "@vivantel/virage-core";
import {
  EXT_GROUPS,
  type ExtGroup,
  detectFileExtensions,
} from "./file-detect.js";

// ─── Back-navigation support ──────────────────────────────────────────────────

const BACK_VALUE = "__back__";

function withBack<T>(
  choices: { name: string; value: T }[],
): { name: string; value: T | typeof BACK_VALUE }[] {
  return [
    ...choices,
    { name: "← Back", value: BACK_VALUE as typeof BACK_VALUE },
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
  if (state.groups.some((g) => g.strategyFn === "codeChunkStrategy"))
    pkgs.add("@vivantel/virage-code-chunk-chunker");
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

function buildGlobalInstallCommand(
  pm: "npm" | "yarn" | "pnpm" | "bun",
  packages: string[],
): { cmd: string; args: string[] } {
  switch (pm) {
    case "yarn":
      return { cmd: "yarn", args: ["global", "add", ...packages] };
    case "pnpm":
      return { cmd: "pnpm", args: ["add", "-g", ...packages] };
    case "bun":
      return { cmd: "bun", args: ["add", "-g", ...packages] };
    default:
      return { cmd: "npm", args: ["install", "-g", ...packages] };
  }
}

async function rotateConfigBackups(configPath: string): Promise<void> {
  const bak = (n: number) => `${configPath}.bak.${n}`;
  // Delete oldest backup if present
  try {
    await rename(bak(5), bak(5) + ".del");
    const { unlink } = await import("fs/promises");
    await unlink(bak(5) + ".del");
  } catch {
    // No .bak.5 to remove
  }
  // Shift .bak.4 → .bak.5, .bak.3 → .bak.4, ... .bak.1 → .bak.2
  for (let i = 4; i >= 1; i--) {
    try {
      await rename(bak(i), bak(i + 1));
    } catch {
      // No backup at this slot
    }
  }
  // Rename current file to .bak.1
  if (existsSync(configPath)) {
    await rename(configPath, bak(1));
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
  codeChunkStrategy: "codeChunkAst",
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

  // For local file-based stores, resolve paths relative to the virage dir so
  // the VIRAGE_DIR env var override is respected at config generation time.
  const resolvedStoreConfig =
    storeEntry.key === "lancedb"
      ? { ...storeEntry.defaultConfig, uri: `${getVirageDir()}/lancedb` }
      : storeEntry.defaultConfig;

  const config = {
    $schema:
      "./node_modules/@vivantel/virage-core/schemas/virage.config.schema.json",
    chunkers,
    embedder: {
      package: embedderEntry.package,
      config: embedderEntry.defaultConfig,
    },
    vectorStore: {
      package: storeEntry.package,
      config: resolvedStoreConfig,
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
  console.log("\nVirage Config Generator\n");

  const defaultConfigPath = "./virage.config.json";
  if (existsSync(defaultConfigPath)) {
    const overwrite = await select({
      message: `Config file ${defaultConfigPath} already exists. Overwrite?`,
      choices: [
        { name: "Yes (backup & overwrite)", value: true },
        { name: "No, cancel", value: false },
      ],
    });
    if (!overwrite) {
      console.log("\nCancelled.");
      return;
    }
  }

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
        const defaultOutput = "./virage.config.json";
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

  // ── Overwrite safety net for custom output path ──
  if (
    finalState.outputPath !== defaultConfigPath &&
    existsSync(finalState.outputPath)
  ) {
    const overwrite = await select({
      message: `${finalState.outputPath} already exists. What would you like to do?`,
      choices: [
        { name: "Yes (backup & overwrite)", value: true },
        { name: "No, cancel (keep existing file)", value: false },
      ],
    });
    if (!overwrite) {
      console.log("\nCancelled.");
      return;
    }
  }

  // ── Write config ──
  await rotateConfigBackups(finalState.outputPath);
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
    const localCmd = buildInstallCommand(pm, pkgs);
    const globalCmd = buildGlobalInstallCommand(pm, pkgs);
    const installChoice = await select({
      message: `Install ${pkgs.join(", ")} using ${pm}?`,
      choices: [
        {
          name: "Yes, install in current folder (recommended)",
          value: "local" as const,
        },
        { name: "Yes, install globally", value: "global" as const },
        { name: "No, I'll install manually", value: "manual" as const },
      ],
    });
    if (installChoice === "local" || installChoice === "global") {
      const { cmd, args } = installChoice === "global" ? globalCmd : localCmd;
      try {
        await runInstall(cmd, args);
        console.log("\nPackages installed successfully.");
      } catch {
        console.log(
          `\nInstall failed. Run manually:\n  ${cmd} ${args.join(" ")}`,
        );
      }
    } else {
      console.log(
        `\nRun manually:\n  ${localCmd.cmd} ${localCmd.args.join(" ")}`,
      );
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
  console.log(`  ${nextStep++}. Run \`virage validate\` to check the config`);
  console.log(`  ${nextStep}. Run \`virage\` to start indexing\n`);
}

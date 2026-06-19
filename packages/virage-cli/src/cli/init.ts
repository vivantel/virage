import { checkbox, input, select } from "@inquirer/prompts";
import { existsSync } from "fs";
import { readFile, rename, writeFile } from "fs/promises";
import { loadRegistry, getVirageDir } from "@vivantel/virage-core";
import type { PluginRegistry } from "@vivantel/virage-core";
import {
  EXT_GROUPS,
  type ExtGroup,
  detectFileExtensions,
} from "./file-detect.js";
import { resolveSkillsPackagePath, syncSkills } from "./skills.js";
import { discoverAgentPlugins, runAgentPlugin } from "./agent-plugin.js";
import {
  detectPackageManager,
  buildInstallCommand,
  buildGlobalInstallCommand,
  runInstall,
} from "./pkg-manager.js";

// ─── Known agent plugins (always shown, regardless of what's installed) ──────

const KNOWN_AGENTS = [
  { name: "claude-code", label: "Claude Code" },
  { name: "copilot", label: "GitHub Copilot" },
  { name: "codex", label: "OpenAI Codex" },
  { name: "antigravity", label: "Antigravity" },
];

// ─── Back-navigation support ──────────────────────────────────────────────────

const BACK_VALUE = "__back__";

function isBack(value: unknown): value is typeof BACK_VALUE {
  return value === BACK_VALUE;
}

function withBack<T>(
  choices: { name: string; value: T }[],
): { name: string; value: T | typeof BACK_VALUE }[] {
  return [
    ...choices,
    { name: "← Back", value: BACK_VALUE as typeof BACK_VALUE },
  ];
}

// ─── Confirmation summary ─────────────────────────────────────────────────────

function formatSummary(state: WizardState, registry: PluginRegistry): string {
  const embedderLabel =
    registry.embedders.find((e) => e.key === state.embedder)?.label ??
    state.embedder;
  const storeLabel =
    registry.stores.find((s) => s.key === state.vectorStore)?.label ??
    state.vectorStore;
  const fileTypesLabel =
    state.groups.length > 0
      ? state.groups.map((g) => g.name).join(", ")
      : "(none)";
  const agentsLabel =
    state.agents.length > 0 ? state.agents.join(", ") : "(none)";

  const rerankerLabel =
    state.reranker === "cross-encoder"
      ? "Cross-encoder (local)"
      : state.reranker === "llm"
        ? "LLM (Anthropic)"
        : "(none)";

  const hybridLabel = state.hybrid
    ? `Enabled (alpha=${state.hybridAlpha ?? 0.6})`
    : "Disabled";

  const width = 52;
  const labelWidth = 14;
  const labelPad = 2; // leading spaces
  const valueWidth = width - 2 - labelPad - labelWidth; // 34

  const wrapValue = (value: string): string[] => {
    const parts = value.split(", ");
    const rows: string[] = [];
    let current = "";
    for (const part of parts) {
      const next = current ? `${current}, ${part}` : part;
      if (current && next.length > valueWidth) {
        rows.push(current);
        current = part;
      } else {
        current = next;
      }
    }
    if (current) rows.push(current);
    return rows.length ? rows : [""];
  };

  const wrapLine = (label: string, value: string): string => {
    const indent = " ".repeat(labelPad + labelWidth);
    return wrapValue(value)
      .map((v, i) => {
        const prefix = i === 0 ? `  ${label.padEnd(labelWidth)}` : indent;
        return `║${(prefix + v).padEnd(width - 2)}║`;
      })
      .join("\n");
  };

  const bar = "═".repeat(width - 2);

  return [
    `╔${bar}╗`,
    `║${"  Configuration Summary".padEnd(width - 2)}║`,
    `╠${bar}╣`,
    wrapLine("File types:", fileTypesLabel),
    wrapLine("Agents:", agentsLabel),
    wrapLine("Embedder:", embedderLabel),
    wrapLine("Vector store:", storeLabel),
    wrapLine("Re-ranker:", rerankerLabel),
    wrapLine("Hybrid search:", hybridLabel),
    wrapLine("Output:", state.outputPath),
    `╚${bar}╝`,
  ].join("\n");
}

// ─── Wizard state ─────────────────────────────────────────────────────────────

interface WizardState {
  outputPath: string;
  groups: ExtGroup[];
  agents: string[];
  embedder: string;
  vectorStore: string;
  reranker?: "cross-encoder" | "llm";
  hybrid?: boolean;
  hybridAlpha?: number;
}

// ─── Package helpers ──────────────────────────────────────────────────────────

const RERANKER_PACKAGES: Record<string, string> = {
  "cross-encoder": "@vivantel/virage-reranker-cross-encoder",
  llm: "@vivantel/virage-reranker-llm",
};

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
  if (state.reranker && RERANKER_PACKAGES[state.reranker])
    pkgs.add(RERANKER_PACKAGES[state.reranker]);
  return Array.from(pkgs);
}

async function rotateConfigBackups(configPath: string): Promise<void> {
  const bak = (n: number) => `${configPath}.bak.${n}`;
  try {
    await rename(bak(5), bak(5) + ".del");
    const { unlink } = await import("fs/promises");
    await unlink(bak(5) + ".del");
  } catch {
    // No .bak.5 to remove
  }
  for (let i = 4; i >= 1; i--) {
    try {
      await rename(bak(i), bak(i + 1));
    } catch {
      // No backup at this slot
    }
  }
  if (existsSync(configPath)) {
    await rename(configPath, bak(1));
  }
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

  const resolvedStoreConfig =
    storeEntry.key === "lancedb"
      ? { ...storeEntry.defaultConfig, uri: `${getVirageDir()}/lancedb` }
      : storeEntry.defaultConfig;

  const rerankerConfig =
    state.reranker === "cross-encoder"
      ? {
          package: "@vivantel/virage-reranker-cross-encoder",
          config: { model: "Xenova/ms-marco-MiniLM-L-6-v2", topK: 5 },
        }
      : state.reranker === "llm"
        ? {
            package: "@vivantel/virage-reranker-llm",
            config: { model: "claude-haiku-4-5", topK: 5 },
          }
        : undefined;

  const config: Record<string, unknown> = {
    $schema:
      "./node_modules/@vivantel/virage-core/schemas/virage.config.schema.json",
    chunkers,
    agents: state.agents,
    embedder: {
      package: embedderEntry.package,
      config: embedderEntry.defaultConfig,
    },
    vectorStore: {
      package: storeEntry.package,
      config: resolvedStoreConfig,
    },
  };

  const searchConfig: Record<string, unknown> = {};
  if (rerankerConfig) searchConfig.reranker = rerankerConfig;
  if (state.hybrid) {
    searchConfig.hybrid = true;
    searchConfig.hybridAlpha = state.hybridAlpha ?? 0.6;
  }
  if (Object.keys(searchConfig).length > 0) {
    config.search = searchConfig;
  }

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

  const cwd = process.cwd();
  console.log("Scanning project for file types...");
  const detectedGroups = await detectFileExtensions(cwd);

  const registry = await loadRegistry(cwd);
  const discoveredAgentPlugins = await discoverAgentPlugins(cwd);

  const state: Partial<WizardState> = {};
  let step = 0;

  while (step < 8) {
    switch (step) {
      // ── Step 0: output path ──
      case 0: {
        const outputPath = await input({
          message: "Output path for the config file?",
          default: "./virage.config.json",
        });
        const resolved = outputPath.trim() || "./virage.config.json";
        if (existsSync(resolved)) {
          const overwrite = await select({
            message: `${resolved} already exists. Overwrite?`,
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
        state.outputPath = resolved;
        step++;
        break;
      }

      // ── Step 1: file types ──
      case 1: {
        if (detectedGroups.length > 0) {
          const confirmed = await checkbox({
            message: "Detected file types — select which to index:",
            choices: detectedGroups.map((g) => ({
              name: `${g.name} (${g.exts.join(", ")}) → ${g.strategyFn}`,
              value: g.name,
              checked: true,
            })),
          });
          state.groups = detectedGroups.filter((g) =>
            confirmed.includes(g.name),
          );
        } else {
          console.log(
            "No known file types detected. Choose strategies manually:",
          );
          const chosen = await checkbox({
            message: "Which chunking strategies do you need?",
            choices: EXT_GROUPS.map((g) => ({
              name: `${g.name} (${g.strategyFn})`,
              value: g.name,
            })),
          });
          state.groups = EXT_GROUPS.filter((g) => chosen.includes(g.name));
        }
        step++;
        break;
      }

      // ── Step 2: coding agents ──
      case 2: {
        const discoveredMap = new Map(
          discoveredAgentPlugins.map((p) => [p.name, p]),
        );
        const pluginChoices = [
          ...KNOWN_AGENTS.map((a) => ({
            name: discoveredMap.get(a.name)?.label ?? a.label,
            value: a.name,
            checked: a.name === "claude-code",
          })),
          ...discoveredAgentPlugins
            .filter((p) => !KNOWN_AGENTS.some((a) => a.name === p.name))
            .map((p) => ({ name: p.label, value: p.name, checked: false })),
        ];

        const agentChoices = await checkbox({
          message: "Select coding agents to integrate:",
          choices: pluginChoices,
        });
        state.agents = agentChoices;
        step++;
        break;
      }

      // ── Step 3: embedder selection ──
      case 3: {
        const choice = await select({
          message: "Which embedding provider?",
          default: "transformers",
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

      // ── Step 4: vector store selection ──
      case 4: {
        const choice = await select({
          message: "Which vector store?",
          default: "lancedb",
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

      // ── Step 5: re-ranker (optional) ──
      case 5: {
        const choice = await select({
          message: "Add a re-ranker? (optional — improves result precision)",
          choices: withBack([
            { name: "No re-ranker (skip)", value: "none" },
            {
              name: "Cross-encoder — local ONNX, no API key required",
              value: "cross-encoder",
            },
            {
              name: "LLM re-ranker — uses Anthropic API (claude-haiku-4-5)",
              value: "llm",
            },
          ]),
        });
        if (isBack(choice)) {
          step--;
          break;
        }
        state.reranker =
          choice === "none" ? undefined : (choice as "cross-encoder" | "llm");
        step++;
        break;
      }

      // ── Step 6: hybrid search ──
      case 6: {
        const hybridChoice = await select({
          message:
            "Enable hybrid search? (BM25 + vector fusion improves recall for keyword-heavy queries)",
          choices: withBack([
            { name: "No — pure vector search", value: "no" },
            {
              name: "Yes — BM25 + vector hybrid (recommended)",
              value: "yes",
            },
          ]),
        });
        if (isBack(hybridChoice)) {
          step--;
          break;
        }
        state.hybrid = hybridChoice === "yes";
        if (state.hybrid) {
          const alphaStr = await input({
            message:
              "Blend weight — hybridAlpha (0 = pure BM25, 1 = pure vector):",
            default: "0.6",
            validate: (v) => {
              const n = parseFloat(v);
              if (isNaN(n) || n < 0 || n > 1)
                return "Enter a number between 0 and 1";
              return true;
            },
          });
          state.hybridAlpha = parseFloat(alphaStr);
        }
        step++;
        break;
      }

      // ── Step 7: confirmation ──
      case 7: {
        console.log("\n" + formatSummary(state as WizardState, registry));
        const confirm = await select({
          message: "Proceed with this configuration?",
          choices: [
            { name: "✓ Confirm", value: "confirm" },
            { name: "← Back", value: "back" },
          ],
        });
        if (confirm === "back") {
          step--;
          break;
        }
        step++;
        break;
      }
    }
  }

  const finalState = state as WizardState;

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

  // ── Skills installation ──
  const skillsPkgPath = resolveSkillsPackagePath();
  if (skillsPkgPath !== null) {
    const installSkills = await select({
      message: "Install Virage AI agent skills?",
      choices: [
        {
          name: "Yes — install/update to .agents/skills/virage/",
          value: true,
        },
        { name: "No, skip", value: false },
      ],
    });
    if (installSkills) {
      try {
        const result = await syncSkills(skillsPkgPath, cwd);
        if (result.created.length > 0)
          console.log(`\nSkills installed: ${result.created.length} new`);
        if (result.updated.length > 0)
          console.log(`Skills updated: ${result.updated.length}`);
        if (result.deleted.length > 0)
          console.log(`Skills removed: ${result.deleted.length}`);
        if (
          result.created.length === 0 &&
          result.updated.length === 0 &&
          result.deleted.length === 0
        )
          console.log("\nSkills already up to date.");
      } catch (err) {
        console.log(
          `\nSkills install failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        console.log("You can retry by running virage init again.");
      }
    }
  }

  // ── Agent plugin configuration ──
  const agentPlugins = discoveredAgentPlugins.filter((p) =>
    finalState.agents.length > 0 ? finalState.agents.includes(p.name) : false,
  );
  if (agentPlugins.length > 0) {
    const selectedPlugins = await checkbox({
      message: "Configure AI agent integration?",
      choices: agentPlugins.map((p) => ({
        name: p.label,
        value: p,
        checked: true,
      })),
    });
    for (const plugin of selectedPlugins) {
      try {
        const result = await runAgentPlugin(plugin, cwd);
        const hookMsg = result.hooksWritten
          ? "config written"
          : "already up to date";
        const mcpMsg =
          result.mcpRegistered === true
            ? "; MCP server registered"
            : result.mcpRegistered === false
              ? "; MCP server already registered"
              : "";
        console.log(`\n${plugin.label}: ${hookMsg}${mcpMsg}`);
      } catch (err) {
        console.log(
          `\n${plugin.label} configuration failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
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

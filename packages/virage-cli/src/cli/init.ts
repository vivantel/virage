import { checkbox, input, select } from "@inquirer/prompts";
import { existsSync } from "fs";
import { readFile, rename, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import {
  loadRegistry,
  getVirageDir,
  DEFAULT_EXCLUDE_PATTERNS,
} from "@vivantel/virage-core";
import type { PluginRegistry } from "@vivantel/virage-core";
import {
  EXT_GROUPS,
  type ExtGroup,
  detectFileExtensions,
} from "./file-detect.js";
import { discoverAgentPlugins, runAgentPlugin } from "./agent-plugin.js";
import {
  getLocalPluginDir,
  getGlobalPluginDir,
  buildPluginPrefixInstallCommand,
  fetchLatestVersion,
  runInstall,
} from "./pkg-manager.js";

// ─── Known agent plugins (always shown, regardless of what's installed) ──────

const KNOWN_AGENTS = [
  {
    name: "claude-code",
    label: "Claude Code",
    package: "@vivantel/virage-agent-claude",
  },
  {
    name: "copilot",
    label: "GitHub Copilot",
    package: "@vivantel/virage-agent-copilot",
  },
  {
    name: "codex",
    label: "OpenAI Codex",
    package: "@vivantel/virage-agent-codex",
  },
  {
    name: "antigravity",
    label: "Antigravity",
    package: "@vivantel/virage-agent-antigravity",
  },
];

const AGENT_PACKAGES: Record<string, string> = Object.fromEntries(
  KNOWN_AGENTS.map((a) => [a.name, a.package]),
);

// ─── Back-navigation support ──────────────────────────────────────────────────

const BACK_VALUE = "__back__";
const EXIT_VALUE = "__exit__";

function isBack(value: unknown): value is typeof BACK_VALUE {
  return value === BACK_VALUE;
}

function isExit(value: unknown): value is typeof EXIT_VALUE {
  return value === EXIT_VALUE;
}

function withBack<T>(
  choices: { name: string; value: T }[],
): { name: string; value: T | typeof BACK_VALUE }[] {
  return [
    ...choices,
    { name: "← Back", value: BACK_VALUE as typeof BACK_VALUE },
  ];
}

function withExit<T>(
  choices: { name: string; value: T }[],
): { name: string; value: T | typeof EXIT_VALUE }[] {
  return [
    ...choices,
    { name: "← Exit", value: EXIT_VALUE as typeof EXIT_VALUE },
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

  const scopeLabel =
    state.installScope === "global"
      ? `Global (~/.virage/plugins)`
      : `Local (${getLocalPluginDir(dirname(resolve(state.outputPath)))})`;

  const width = 52;
  const labelWidth = 14;
  const labelPad = 2;
  const valueWidth = width - 2 - labelPad - labelWidth;

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
    wrapLine("Install scope:", scopeLabel),
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
  installScope: "local" | "global";
  pluginVersions: Record<string, string>;
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
  // Add agent packages for selected agents
  for (const agent of state.agents) {
    const pkg = AGENT_PACKAGES[agent];
    if (pkg) pkgs.add(pkg);
  }
  return Array.from(pkgs);
}

async function rotateConfigBackups(configPath: string): Promise<void> {
  if (!existsSync(configPath)) return;

  const bak = (n: number) => `${configPath}.bak.${n}`;

  if (existsSync(bak(1))) {
    try {
      const [current, latest] = await Promise.all([
        readFile(configPath, "utf-8"),
        readFile(bak(1), "utf-8"),
      ]);
      if (current === latest) return;
    } catch {
      // If we can't read either file, proceed with the normal rotation
    }
  }

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
  await rename(configPath, bak(1));
}

// ─── Config generation ────────────────────────────────────────────────────────

const STRATEGY_FN_TO_JSON: Record<string, string> = {
  markdownHeadersStrategy: "markdownHeaders",
  tokenStrategy: "token",
  wholeFileStrategy: "wholeFile",
  semanticStrategy: "semantic",
  codeChunkStrategy: "codeChunkAst",
};

function buildExcludePatterns(groups: ExtGroup[]): string[] {
  const patterns = new Set(DEFAULT_EXCLUDE_PATTERNS);
  const groupNames = new Set(groups.map((g) => g.name));
  if (groupNames.has("java")) {
    patterns.add("**/target/**");
    patterns.add("**/*.class");
  }
  if (groupNames.has("csharp")) {
    patterns.add("**/bin/**");
    patterns.add("**/obj/**");
    patterns.add("**/*.generated.cs");
  }
  return [...patterns].sort();
}

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
      "https://unpkg.com/@vivantel/virage-core/schemas/virage.config.schema.json",
    chunking: {
      exclude: buildExcludePatterns(effectiveGroups),
      chunkers,
    },
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

  if (Object.keys(state.pluginVersions).length > 0) {
    config.pluginVersions = state.pluginVersions;
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

  // 9 steps (0–8); step 9 exits the loop
  while (step < 9) {
    switch (step) {
      // ── Step 0: output path (Exit instead of Back) ──
      case 0: {
        const pathChoice = await select({
          message: "Config file output path?",
          choices: withExit([
            {
              name: "Use default (./virage.config.json)",
              value: "default" as const,
            },
            { name: "Enter custom path", value: "custom" as const },
          ]),
        });
        if (isExit(pathChoice)) {
          console.log("\nExiting.");
          return;
        }

        let outputPath = "./virage.config.json";
        if (pathChoice === "custom") {
          outputPath = await input({
            message: "Custom output path:",
            default: "./virage.config.json",
          });
          outputPath = outputPath.trim() || "./virage.config.json";
        }

        if (existsSync(outputPath)) {
          const overwrite = await select({
            message: `${outputPath} already exists. Overwrite?`,
            choices: withBack([
              { name: "Yes (backup & overwrite)", value: "overwrite" as const },
            ]),
          });
          if (isBack(overwrite)) break; // re-run step 0
          // overwrite === "overwrite"
        }

        state.outputPath = outputPath;
        step++;
        break;
      }

      // ── Step 1: file types ──
      case 1: {
        if (detectedGroups.length > 0) {
          const choices = withBack(
            detectedGroups.map((g) => ({
              name: `${g.name} (${g.exts.join(", ")}) → ${g.strategyFn}`,
              value: g.name,
            })),
          );
          const confirmed = await checkbox({
            message: "Detected file types — select which to index:",
            choices: choices.map((c) => ({
              ...c,
              checked: !isBack(c.value),
            })),
          });
          if (confirmed.includes(BACK_VALUE)) {
            step--;
            break;
          }
          state.groups = detectedGroups.filter((g) =>
            confirmed.includes(g.name),
          );
        } else {
          console.log(
            "No known file types detected. Choose strategies manually:",
          );
          const choices = withBack(
            EXT_GROUPS.map((g) => ({
              name: `${g.name} (${g.strategyFn})`,
              value: g.name,
            })),
          );
          const chosen = await checkbox({
            message: "Which chunking strategies do you need?",
            choices,
          });
          if (chosen.includes(BACK_VALUE)) {
            step--;
            break;
          }
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
        const agentChoices = withBack([
          ...KNOWN_AGENTS.map((a) => ({
            name: discoveredMap.get(a.name)?.label ?? a.label,
            value: a.name,
          })),
          ...discoveredAgentPlugins
            .filter((p) => !KNOWN_AGENTS.some((a) => a.name === p.name))
            .map((p) => ({ name: p.label, value: p.name })),
        ]);

        const selected = await checkbox({
          message: "Select coding agents to integrate:",
          choices: agentChoices.map((c) => ({
            ...c,
            checked: !isBack(c.value) && c.value === "claude-code",
          })),
        });
        if (selected.includes(BACK_VALUE)) {
          step--;
          break;
        }
        state.agents = selected.filter((v) => !isBack(v)) as string[];
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
        // Sub-loop: yes/no → optionally hybridAlpha.
        // Back in yes/no → previous step. Back in alpha → re-run yes/no.
        let backToStep5 = false;
        let step6Done = false;

        while (!step6Done && !backToStep5) {
          const hybridChoice = await select({
            message:
              "Enable hybrid search? (BM25 + vector fusion improves recall for keyword-heavy queries)",
            default: "yes",
            choices: withBack([
              {
                name: "Yes — BM25 + vector hybrid (recommended)",
                value: "yes",
              },
              { name: "No — pure vector search", value: "no" },
            ]),
          });

          if (isBack(hybridChoice)) {
            backToStep5 = true;
            break;
          }

          state.hybrid = hybridChoice === "yes";

          if (state.hybrid) {
            const alphaChoice = await select({
              message:
                "Blend weight — hybridAlpha (0 = pure BM25, 1 = pure vector):",
              default: "0.6",
              choices: withBack([
                { name: "0.6 (recommended)", value: "0.6" },
                { name: "0.3 (lean BM25)", value: "0.3" },
                { name: "0.8 (lean vector)", value: "0.8" },
                { name: "Enter custom value", value: "custom" },
              ]),
            });

            if (isBack(alphaChoice)) {
              // Back within step 6 → re-run the yes/no prompt
              state.hybrid = undefined;
              state.hybridAlpha = undefined;
              continue;
            }

            if (alphaChoice === "custom") {
              const alphaStr = await input({
                message: "hybridAlpha (0.0–1.0):",
                default: "0.6",
                validate: (v) => {
                  const n = parseFloat(v);
                  if (isNaN(n) || n < 0 || n > 1)
                    return "Enter a number between 0 and 1";
                  return true;
                },
              });
              state.hybridAlpha = parseFloat(alphaStr);
            } else {
              state.hybridAlpha = parseFloat(alphaChoice);
            }
          }

          step6Done = true;
        }

        if (backToStep5) {
          step--;
        } else {
          step++;
        }
        break;
      }

      // ── Step 7: install scope ──
      case 7: {
        const configDir = dirname(resolve(state.outputPath!));
        const localDir = getLocalPluginDir(configDir);
        const globalDir = getGlobalPluginDir();
        const choice = await select({
          message: "Where should virage plugins be installed?",
          choices: withBack([
            {
              name: `Local — ${localDir}`,
              value: "local" as const,
            },
            {
              name: `Global — ${globalDir}`,
              value: "global" as const,
            },
          ]),
        });
        if (isBack(choice)) {
          step--;
          break;
        }
        state.installScope = choice;
        step++;
        break;
      }

      // ── Step 8: confirmation ──
      case 8: {
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
  finalState.pluginVersions = {};

  // ── Resolve and install plugins ──
  const pkgs = getRequiredPackages(finalState, registry);
  const configDir = dirname(resolve(finalState.outputPath));
  const pluginDir =
    finalState.installScope === "global"
      ? getGlobalPluginDir()
      : getLocalPluginDir(configDir);

  if (pkgs.length > 0) {
    console.log(`\nResolving plugin versions...`);

    const versions = await Promise.all(pkgs.map(fetchLatestVersion));
    const versionedPkgs = pkgs.map((pkg, i) => {
      const ver = versions[i];
      finalState.pluginVersions[pkg] = ver;
      return ver === "latest" ? pkg : `${pkg}@${ver}`;
    });

    console.log(`Installing to ${pluginDir}...`);
    const { cmd, args } = buildPluginPrefixInstallCommand(
      versionedPkgs,
      pluginDir,
    );
    try {
      await runInstall(cmd, args);
      console.log("\nPlugins installed successfully.");
    } catch {
      console.log(
        `\nInstall failed. Run manually:\n  ${cmd} ${args.join(" ")}`,
      );
    }
  }

  // ── Agent plugin configuration ──
  // Re-discover after install so plugins in the new plugin dir are found
  const freshAgentPlugins = await discoverAgentPlugins(cwd);
  const agentPluginsToRun = freshAgentPlugins.filter((p) =>
    finalState.agents.includes(p.name),
  );

  for (const plugin of agentPluginsToRun) {
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

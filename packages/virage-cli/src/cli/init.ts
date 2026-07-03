import { input, select } from "@inquirer/prompts";
import {
  checkboxWithBack,
  CHECKBOX_BACK,
  selectWithBack,
  SELECT_BACK,
} from "./checkbox-nav.js";
import { existsSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, relative, resolve } from "path";
import {
  loadRegistry,
  getVirageDir,
  DEFAULT_EXCLUDE_PATTERNS,
  COMMUNITY_TELEMETRY_ENDPOINT,
} from "@vivantel/virage-core";
import type { PluginRegistry } from "@vivantel/virage-core";
import {
  EXT_GROUPS,
  type ExtGroup,
  detectFileExtensions,
} from "./file-detect.js";
import { discoverAgentPlugins, runAgentPlugin } from "./agent-plugin.js";
import { createOut } from "../output.js";
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

  const localDir = getLocalPluginDir(dirname(resolve(state.outputPath)));
  const scopeLabel =
    state.installScope === "global"
      ? `Global (~/.virage/plugins)`
      : `Local (${relative(process.cwd(), localDir) || ".virage/plugins"})`;

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
  for (const g of state.groups) {
    if (g.strategy.startsWith("@") || g.strategy.includes("/"))
      pkgs.add(g.strategy);
  }
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

  const fileSets = effectiveGroups.map((g) => {
    const isPackage = g.strategy.startsWith("@") || g.strategy.includes("/");
    const chunkerEntry: Record<string, unknown> = {
      package: isPackage
        ? g.strategy
        : `@vivantel/virage-chunker-${g.strategy}`,
    };
    if (g.strategyOptions && Object.keys(g.strategyOptions).length > 0)
      chunkerEntry.options = g.strategyOptions;
    const fileSet: Record<string, unknown> = {
      name: g.name,
      include: g.exts.map((e) => `**/*${e}`),
      chunkers: [chunkerEntry],
    };
    return fileSet;
  });

  const embedderEntry = registry.embedders.find(
    (e) => e.key === state.embedder,
  )!;
  const storeEntry = registry.stores.find((s) => s.key === state.vectorStore)!;

  const resolvedStoreOptions =
    storeEntry.key === "lancedb"
      ? { ...storeEntry.defaultConfig, uri: `${getVirageDir()}/lancedb` }
      : storeEntry.defaultConfig;

  const rerankerRef =
    state.reranker === "cross-encoder"
      ? {
          package: "@vivantel/virage-reranker-cross-encoder",
          options: { model: "Xenova/ms-marco-MiniLM-L-6-v2", topK: 5 },
        }
      : state.reranker === "llm"
        ? {
            package: "@vivantel/virage-reranker-llm",
            options: { model: "claude-haiku-4-5", topK: 5 },
          }
        : undefined;

  const providers: Record<string, unknown> = {
    embedder: {
      package: embedderEntry.package,
      options: embedderEntry.defaultConfig,
    },
    vectorStore: {
      package: storeEntry.package,
      options: resolvedStoreOptions,
    },
  };
  if (rerankerRef) providers.reranker = rerankerRef;

  const config: Record<string, unknown> = {
    $schema:
      "https://unpkg.com/@vivantel/virage-core/schemas/virage.config.schema.json",
    providers,
    fileSets,
    ignore: buildExcludePatterns(effectiveGroups),
    agents: state.agents.map((name) => ({
      package: AGENT_PACKAGES[name] ?? name,
    })),
  };

  const searchConfig: Record<string, unknown> = {};
  if (state.hybrid) {
    searchConfig.hybrid = true;
    searchConfig.hybridAlpha = state.hybridAlpha ?? 0.6;
  }
  if (Object.keys(searchConfig).length > 0) {
    config.search = searchConfig;
  }

  config.installScope = state.installScope;

  config.telemetry = {
    enabled: true,
    endpoint: COMMUNITY_TELEMETRY_ENDPOINT,
    tiers: { implicit: true },
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

export async function runInit(verbosity = 0): Promise<void> {
  const out = createOut(verbosity);
  out.section("Virage Config Generator");

  const cwd = process.cwd();
  out.info("Scanning project for file types...");
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
          out.dim("Exiting.");
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
          const confirmed = await checkboxWithBack({
            message: "Detected file types — select which to index:",
            choices: detectedGroups.map((g) => ({
              name: `${g.name} (${g.exts.join(", ")}) → ${g.strategy}`,
              value: g.name,
              checked: true,
            })),
          });
          if (confirmed === CHECKBOX_BACK) {
            step--;
            break;
          }
          state.groups = detectedGroups.filter((g) =>
            confirmed.includes(g.name),
          );
        } else {
          out.info("No known file types detected. Choose strategies manually:");
          const chosen = await checkboxWithBack({
            message: "Which chunking strategies do you need?",
            choices: EXT_GROUPS.map((g) => ({
              name: `${g.name} (${g.strategy})`,
              value: g.name,
            })),
          });
          if (chosen === CHECKBOX_BACK) {
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
        const agentItems = [
          ...KNOWN_AGENTS.map((a) => ({
            name: discoveredMap.get(a.name)?.label ?? a.label,
            value: a.name,
          })),
          ...discoveredAgentPlugins
            .filter((p) => !KNOWN_AGENTS.some((a) => a.name === p.name))
            .map((p) => ({ name: p.label, value: p.name })),
        ];

        const selected = await checkboxWithBack({
          message: "Select coding agents to integrate:",
          choices: agentItems.map((a) => ({
            ...a,
            checked: a.value === "claude-code",
          })),
        });
        if (selected === CHECKBOX_BACK) {
          step--;
          break;
        }
        state.agents = selected as string[];
        step++;
        break;
      }

      // ── Step 3: embedder selection ──
      case 3: {
        const choice = await selectWithBack({
          message: "Which embedding provider?",
          default: "onnx",
          choices: registry.embedders.map((e) => ({
            name: e.label,
            value: e.key,
          })),
        });
        if (choice === SELECT_BACK) {
          step--;
          break;
        }
        state.embedder = choice;
        step++;
        break;
      }

      // ── Step 4: vector store selection ──
      case 4: {
        const choice = await selectWithBack({
          message: "Which vector store?",
          default: "lancedb",
          choices: registry.stores.map((s) => ({
            name: s.label,
            value: s.key,
          })),
        });
        if (choice === SELECT_BACK) {
          step--;
          break;
        }
        state.vectorStore = choice;
        step++;
        break;
      }

      // ── Step 5: re-ranker (optional) ──
      case 5: {
        const choice = await selectWithBack({
          message: "Add a re-ranker? (optional — improves result precision)",
          default: "cross-encoder",
          choices: [
            {
              name: "Cross-encoder — local ONNX, no API key required",
              value: "cross-encoder",
            },
            {
              name: "LLM re-ranker — uses Anthropic API (claude-haiku-4-5)",
              value: "llm",
            },
            { name: "No re-ranker (skip)", value: "none" },
          ],
        });
        if (choice === SELECT_BACK) {
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
          const hybridChoice = await selectWithBack({
            message:
              "Enable hybrid search? (BM25 + vector fusion improves recall for keyword-heavy queries)",
            default: "yes",
            choices: [
              {
                name: "Yes — BM25 + vector hybrid (recommended)",
                value: "yes",
              },
              { name: "No — pure vector search", value: "no" },
            ],
          });

          if (hybridChoice === SELECT_BACK) {
            backToStep5 = true;
            break;
          }

          state.hybrid = hybridChoice === "yes";

          if (state.hybrid) {
            const alphaChoice = await selectWithBack({
              message:
                "Blend weight — hybridAlpha (0 = pure BM25, 1 = pure vector):",
              default: "0.6",
              choices: [
                { name: "0.6 (recommended)", value: "0.6" },
                { name: "0.3 (lean BM25)", value: "0.3" },
                { name: "0.8 (lean vector)", value: "0.8" },
                { name: "Enter custom value", value: "custom" },
              ],
            });

            if (alphaChoice === SELECT_BACK) {
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
        const choice = await selectWithBack({
          message: "Where should virage plugins be installed?",
          choices: [
            {
              name: `Local — ${localDir}`,
              value: "local" as const,
            },
            {
              name: `Global — ${globalDir}`,
              value: "global" as const,
            },
          ],
        });
        if (choice === SELECT_BACK) {
          step--;
          break;
        }
        state.installScope = choice;
        step++;
        break;
      }

      // ── Step 8: confirmation ──
      case 8: {
        out.info("\n" + formatSummary(state as WizardState, registry));
        const confirm = await selectWithBack({
          message: "Proceed with this configuration?",
          choices: [{ name: "✓ Confirm", value: "confirm" }],
        });
        if (confirm === SELECT_BACK) {
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
    out.info("Resolving plugin versions...");

    const pinnedVersions = new Map(
      finalState.groups
        .filter(
          (g) =>
            g.version &&
            (g.strategy.startsWith("@") || g.strategy.includes("/")),
        )
        .map((g) => [g.strategy, g.version!]),
    );
    const versions = await Promise.all(
      pkgs.map((pkg) =>
        pinnedVersions.has(pkg)
          ? Promise.resolve(pinnedVersions.get(pkg)!)
          : fetchLatestVersion(pkg),
      ),
    );
    const versionedPkgs = pkgs.map((pkg, i) => {
      const ver = versions[i];
      // Store with tilde range for auto-patch-update; pinned versions are preserved as-is.
      finalState.pluginVersions[pkg] =
        pinnedVersions.has(pkg) || ver === "latest" ? ver : `~${ver}`;
      return ver === "latest" ? pkg : `${pkg}@${ver}`;
    });

    out.info(`Installing to ${pluginDir}...`);
    await mkdir(pluginDir, { recursive: true });
    const { cmd, args } = buildPluginPrefixInstallCommand(
      versionedPkgs,
      pluginDir,
    );
    try {
      await runInstall(cmd, args);
      out.success("Plugins installed successfully.");
    } catch {
      out.error(`Install failed. Run manually:\n  ${cmd} ${args.join(" ")}`);
    }
  }

  // ── Agent plugin configuration ──
  // Re-discover after install so plugins in the new plugin dir are found
  const freshAgentPlugins = await discoverAgentPlugins(cwd);
  const agentPluginsToRun = freshAgentPlugins.filter(
    (p) =>
      finalState.agents.includes(p.name) ||
      finalState.agents.some((name) => AGENT_PACKAGES[name] === p.packageName),
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
      out.success(`${plugin.label}: ${hookMsg}${mcpMsg}`);
    } catch (err) {
      out.warn(
        `${plugin.label} configuration failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Write config ──
  await rotateConfigBackups(finalState.outputPath);
  const configContent = generateJsonConfig(finalState, registry);
  await writeFile(finalState.outputPath, configContent, "utf-8");
  out.success(`Created ${finalState.outputPath}`);

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
    out.info("This configuration requires the following secrets:");
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
        out.success(`Wrote to ${envPath}: ${written.join(", ")}`);
      }
      if (skipped.length > 0) {
        out.dim(`Already defined (skipped): ${skipped.join(", ")}`);
      }
    } else {
      out.dim("No secrets entered — add them to your .env file manually.");
    }
  } else {
    out.dim("No secrets required for this combination.");
  }

  out.section("Next steps");
  let nextStep = 1;
  if (finalState.vectorStore === "qdrant") {
    out.info(
      `  ${nextStep++}. Qdrant local: docker run -p 6333:6333 qdrant/qdrant`,
    );
    out.dim(
      `     Set QDRANT_URL=http://localhost:6333 (local) or your cluster URL (cloud).`,
    );
  }
  out.info(`  ${nextStep++}. Run \`virage validate\` to check the config`);
  out.info(`  ${nextStep}. Run \`virage\` to start indexing`);
}

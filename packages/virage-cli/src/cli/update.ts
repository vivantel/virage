import { checkbox } from "@inquirer/prompts";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { discoverAgentPlugins, runAgentPlugin } from "./agent-plugin.js";
import { resolveSkillsPackagePath, syncSkills } from "./skills.js";
import {
  detectPackageManager,
  buildInstallCommand,
  buildGlobalInstallCommand,
  getLocalPluginDir,
  getGlobalPluginDir,
  buildPluginPrefixInstallCommand,
  runInstall,
} from "./pkg-manager.js";

const execFileAsync = promisify(execFile);

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  "rag-plugin"?: unknown;
  "virage-agent"?: unknown;
}

interface VirageConfig {
  embedder?: { package?: string };
  vectorStore?: { package?: string };
  search?: { reranker?: { package?: string } };
  agents?: string[];
  pluginVersions?: Record<string, string>;
  chunkers?: Array<{ strategy?: string }>;
}

const AGENT_PACKAGES: Record<string, string> = {
  "claude-code": "@vivantel/virage-agent-claude",
  copilot: "@vivantel/virage-agent-copilot",
  codex: "@vivantel/virage-agent-codex",
  antigravity: "@vivantel/virage-agent-antigravity",
};

async function readProjectPackageJson(
  cwd: string,
): Promise<PackageJson | null> {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const raw = await readFile(pkgPath, "utf-8");
    return JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
}

async function readNodeModulePackageJson(
  cwd: string,
  packageName: string,
): Promise<PackageJson | null> {
  const pkgPath = join(cwd, "node_modules", packageName, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const raw = await readFile(pkgPath, "utf-8");
    return JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
}

async function readVirageConfig(cwd: string): Promise<VirageConfig | null> {
  const configPath = join(cwd, "virage.config.json");
  if (!existsSync(configPath)) return null;
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw) as VirageConfig;
  } catch {
    return null;
  }
}

async function discoverViragePackages(
  cwd: string,
  isGlobal: boolean,
): Promise<string[]> {
  const candidates = new Set<string>();

  // Always include virage-core and virage-skills — required by every project
  candidates.add("@vivantel/virage-core");
  candidates.add("@vivantel/virage-skills");

  // Config-first: read virage.config.json to discover required packages
  const virageConfig = await readVirageConfig(cwd);
  if (virageConfig) {
    if (virageConfig.embedder?.package) {
      candidates.add(virageConfig.embedder.package);
    }
    if (virageConfig.vectorStore?.package) {
      candidates.add(virageConfig.vectorStore.package);
    }
    if (virageConfig.search?.reranker?.package) {
      candidates.add(virageConfig.search.reranker.package);
    }
    for (const agent of virageConfig.agents ?? []) {
      const pkg = AGENT_PACKAGES[agent];
      if (pkg) candidates.add(pkg);
    }
    const CHUNKER_STRATEGY_PACKAGES: Record<string, string> = {
      codeChunkAst: "@vivantel/virage-code-chunk-chunker",
    };
    for (const chunker of virageConfig.chunkers ?? []) {
      const pkg =
        chunker.strategy && CHUNKER_STRATEGY_PACKAGES[chunker.strategy];
      if (pkg) candidates.add(pkg);
    }
  }

  // Supplement: if package.json exists, also scan it for any @vivantel/* or
  // rag-plugin/virage-agent packages not already covered by config
  if (!isGlobal) {
    const projectPkg = await readProjectPackageJson(cwd);
    if (projectPkg) {
      const allDeps = {
        ...projectPkg.dependencies,
        ...projectPkg.devDependencies,
      };
      for (const pkgName of Object.keys(allDeps)) {
        if (pkgName.startsWith("@vivantel/")) {
          candidates.add(pkgName);
          continue;
        }
        const depPkg = await readNodeModulePackageJson(cwd, pkgName);
        if (depPkg && (depPkg["rag-plugin"] || depPkg["virage-agent"])) {
          candidates.add(pkgName);
        }
      }
    }
  }

  return Array.from(candidates);
}

async function getLatestVersion(packageName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "npm",
      ["view", packageName, "version", "--json", "--prefer-online"],
      { timeout: 10_000 },
    );
    return (JSON.parse(stdout.trim()) as string).trim();
  } catch {
    return null;
  }
}

async function readPluginDirPackageJson(
  pluginDir: string,
  packageName: string,
): Promise<PackageJson | null> {
  const pkgPath = join(pluginDir, "node_modules", packageName, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const raw = await readFile(pkgPath, "utf-8");
    return JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
}

async function getCurrentVersion(
  cwd: string,
  packageName: string,
): Promise<string | null> {
  // Check local plugin dir first (highest priority)
  const localPluginPkg = await readPluginDirPackageJson(
    getLocalPluginDir(cwd),
    packageName,
  );
  if (localPluginPkg?.version) return localPluginPkg.version;

  // Check global plugin dir
  const globalPluginPkg = await readPluginDirPackageJson(
    getGlobalPluginDir(),
    packageName,
  );
  if (globalPluginPkg?.version) return globalPluginPkg.version;

  // Try local node_modules (backwards compat)
  const pkg = await readNodeModulePackageJson(cwd, packageName);
  if (pkg?.version) return pkg.version;

  // Fallback: query npm for the installed version (works for global installs)
  try {
    const { stdout } = await execFileAsync(
      "npm",
      ["list", packageName, "--json", "--depth=0"],
      { timeout: 10_000 },
    );
    const parsed = JSON.parse(stdout) as {
      dependencies?: Record<string, { version?: string }>;
    };
    const version = parsed.dependencies?.[packageName]?.version;
    return version ?? null;
  } catch {
    return null;
  }
}

async function getPackageInstallLocation(
  cwd: string,
  packageName: string,
): Promise<"local-plugin" | "global-plugin" | "node_modules" | "global-npm"> {
  if (
    (await readPluginDirPackageJson(getLocalPluginDir(cwd), packageName))
      ?.version
  )
    return "local-plugin";
  if (
    (await readPluginDirPackageJson(getGlobalPluginDir(), packageName))?.version
  )
    return "global-plugin";
  if ((await readNodeModulePackageJson(cwd, packageName))?.version)
    return "node_modules";
  return "global-npm";
}

interface PackageStatus {
  name: string;
  current: string;
  latest: string;
  outdated: boolean;
  location: "local-plugin" | "global-plugin" | "node_modules" | "global-npm";
}

export async function runUpdate(): Promise<void> {
  const cwd = process.cwd();

  const hasPackageJson = existsSync(join(cwd, "package.json"));
  const hasVirageConfig = existsSync(join(cwd, "virage.config.json"));

  if (!hasPackageJson && !hasVirageConfig) {
    console.log(
      "\nNo virage.config.json found in current directory.\n" +
        "Run `virage init` first to configure your project.\n",
    );
    return;
  }

  const isGlobal = !hasPackageJson;
  if (isGlobal) {
    console.log(
      "\n(No package.json found — treating as standalone project, will install globally.)\n",
    );
  }

  console.log("\nVirage Update\n");
  console.log("Discovering virage ecosystem packages...");

  const packageNames = await discoverViragePackages(cwd, isGlobal);

  // Fetch current and latest versions in parallel
  const statuses = await Promise.all(
    packageNames.map(async (name): Promise<PackageStatus> => {
      const [current, latest, location] = await Promise.all([
        getCurrentVersion(cwd, name),
        getLatestVersion(name),
        getPackageInstallLocation(cwd, name),
      ]);
      const cur = current ?? "unknown";
      const lat = latest ?? "unknown";
      return {
        name,
        current: cur,
        latest: lat,
        outdated: cur !== "unknown" && lat !== "unknown" && cur !== lat,
        location,
      };
    }),
  );

  const outdated = statuses.filter((s) => s.outdated);
  const unknownLatest = statuses.filter((s) => s.latest === "unknown");

  if (outdated.length === 0) {
    console.log("\nAll virage packages are up to date.\n");
  } else {
    console.log(`\nFound ${outdated.length} outdated package(s):`);
    for (const s of outdated) {
      console.log(`  ${s.name}: ${s.current} → ${s.latest}`);
    }
  }
  if (unknownLatest.length > 0) {
    console.log(
      `\nCould not fetch latest version for ${unknownLatest.length} package(s) (registry unreachable?):`,
    );
    for (const s of unknownLatest) {
      console.log(`  ${s.name}: ${s.current}`);
    }
  }

  if (statuses.length === 0) {
    console.log("\nNo virage packages to update.\n");
    return;
  }

  // Let user pick which packages to update
  const toUpdate = await checkbox({
    message: "Select packages to update:",
    choices: statuses.map((s) => ({
      name: s.outdated
        ? `${s.name}  (${s.current} → ${s.latest})`
        : s.latest === "unknown"
          ? `${s.name}  (${s.current}, latest unknown)`
          : `${s.name}  (${s.current}, up to date)`,
      value: s.name,
      checked: true,
    })),
  });

  if (toUpdate.length > 0) {
    const pm = await detectPackageManager(cwd);

    // Split packages by install location
    const selectedStatuses = statuses.filter((s) => toUpdate.includes(s.name));
    const localPluginPkgs = selectedStatuses
      .filter((s) => s.location === "local-plugin")
      .map((s) => `${s.name}@latest`);
    const globalPluginPkgs = selectedStatuses
      .filter((s) => s.location === "global-plugin")
      .map((s) => `${s.name}@latest`);
    const nodeModulesPkgs = selectedStatuses
      .filter(
        (s) => s.location === "node_modules" || s.location === "global-npm",
      )
      .map((s) => `${s.name}@latest`);

    let updateFailed = false;

    if (localPluginPkgs.length > 0) {
      const { cmd, args } = buildPluginPrefixInstallCommand(
        localPluginPkgs,
        getLocalPluginDir(cwd),
      );
      console.log(`\nRunning: ${cmd} ${args.join(" ")}`);
      try {
        await runInstall(cmd, args);
      } catch {
        console.log("\nLocal plugin update failed. Try running manually:");
        console.log(`  ${cmd} ${args.join(" ")}`);
        updateFailed = true;
      }
    }

    if (globalPluginPkgs.length > 0) {
      const { cmd, args } = buildPluginPrefixInstallCommand(
        globalPluginPkgs,
        getGlobalPluginDir(),
      );
      console.log(`\nRunning: ${cmd} ${args.join(" ")}`);
      try {
        await runInstall(cmd, args);
      } catch {
        console.log("\nGlobal plugin update failed. Try running manually:");
        console.log(`  ${cmd} ${args.join(" ")}`);
        updateFailed = true;
      }
    }

    if (nodeModulesPkgs.length > 0) {
      const { cmd, args } = isGlobal
        ? buildGlobalInstallCommand(pm, nodeModulesPkgs)
        : buildInstallCommand(pm, nodeModulesPkgs);
      console.log(`\nRunning: ${cmd} ${args.join(" ")}`);
      try {
        await runInstall(cmd, args);
      } catch {
        console.log("\nUpdate failed. Try running manually:");
        console.log(`  ${cmd} ${args.join(" ")}`);
        updateFailed = true;
      }
    }

    if (!updateFailed) {
      console.log("\nPackages updated successfully.");

      // Rewrite pluginVersions in virage.config.json for plugin-dir packages
      const configPath = join(cwd, "virage.config.json");
      if (existsSync(configPath)) {
        try {
          const raw = await readFile(configPath, "utf-8");
          const cfg = JSON.parse(raw) as Record<string, unknown>;
          const existingVersions =
            (cfg.pluginVersions as Record<string, string> | undefined) ?? {};
          for (const s of selectedStatuses) {
            if (
              s.location === "local-plugin" ||
              s.location === "global-plugin"
            ) {
              existingVersions[s.name] = s.latest;
            }
          }
          cfg.pluginVersions = existingVersions;
          await writeFile(configPath, JSON.stringify(cfg, null, 2) + "\n");
        } catch {
          // Non-fatal: config update failed but packages were installed
        }
      }
    }
  }

  // Always re-run agent plugin configure() to sync plugin-config files
  const agentPlugins = await discoverAgentPlugins(cwd);
  if (agentPlugins.length > 0) {
    console.log("\nSyncing agent plugin configs...");
    for (const plugin of agentPlugins) {
      try {
        const result = await runAgentPlugin(plugin, cwd);
        const msg = result.hooksWritten
          ? "config updated"
          : "already up to date";
        const mcpMsg =
          result.mcpRegistered === true
            ? "; MCP server registered"
            : result.mcpRegistered === false
              ? "; MCP server already registered"
              : "";
        console.log(`  ${plugin.label}: ${msg}${mcpMsg}`);
      } catch (err) {
        console.log(
          `  ${plugin.label} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Auto-sync skills if available — no interactive prompt needed
  const skillsPkgPath = resolveSkillsPackagePath();
  if (skillsPkgPath !== null) {
    console.log("\nSyncing Virage AI agent skills...");
    try {
      const result = await syncSkills(skillsPkgPath, cwd);
      if (result.created.length > 0)
        console.log(`  Skills installed: ${result.created.length} new`);
      if (result.updated.length > 0)
        console.log(`  Skills updated: ${result.updated.length}`);
      if (result.deleted.length > 0)
        console.log(`  Skills removed: ${result.deleted.length}`);
      if (
        result.created.length === 0 &&
        result.updated.length === 0 &&
        result.deleted.length === 0
      )
        console.log("  Already up to date.");
    } catch (err) {
      console.log(
        `  Skills sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log("\nDone.\n");
}

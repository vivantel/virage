import { checkbox } from "@inquirer/prompts";
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createOut } from "../output.js";
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
const isWin = process.platform === "win32";
const npmBin = isWin ? "npm.cmd" : "npm";

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  "rag-plugin"?: unknown;
  "virage-agent"?: unknown;
}

interface VirageConfig {
  providers?: {
    embedder?: { package?: string };
    vectorStore?: { package?: string };
    reranker?: { package?: string };
    source?: { package?: string };
  };
  search?: { reranker?: { package?: string } };
  agents?: Array<{ package: string } | string>;
  fileSets?: Array<{ chunkers?: Array<{ package?: string }> }>;
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

async function readVirageConfig(
  configPath: string,
): Promise<VirageConfig | null> {
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
  configPath: string,
  isGlobal: boolean,
): Promise<string[]> {
  const candidates = new Set<string>();

  // Always include virage-core and virage-skills — required by every project
  candidates.add("@vivantel/virage-core");
  candidates.add("@vivantel/virage-skills");

  // Config-first: read virage.config.json to discover required packages
  const virageConfig = await readVirageConfig(configPath);
  if (virageConfig) {
    if (virageConfig.providers?.embedder?.package) {
      candidates.add(virageConfig.providers.embedder.package);
    }
    if (virageConfig.providers?.vectorStore?.package) {
      candidates.add(virageConfig.providers.vectorStore.package);
    }
    if (virageConfig.providers?.reranker?.package) {
      candidates.add(virageConfig.providers.reranker.package);
    }
    if (virageConfig.providers?.source?.package) {
      candidates.add(virageConfig.providers.source.package);
    }
    if (virageConfig.search?.reranker?.package) {
      candidates.add(virageConfig.search.reranker.package);
    }
    for (const agent of virageConfig.agents ?? []) {
      if (typeof agent === "string") {
        const pkg = AGENT_PACKAGES[agent];
        if (pkg) candidates.add(pkg);
      } else if (agent.package) {
        candidates.add(agent.package);
      }
    }
    for (const fileSet of virageConfig.fileSets ?? []) {
      for (const chunker of fileSet.chunkers ?? []) {
        if (chunker.package) candidates.add(chunker.package);
      }
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
      npmBin,
      ["view", packageName, "version", "--json", "--prefer-online"],
      { timeout: 10_000, shell: isWin },
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
      npmBin,
      ["list", packageName, "--json", "--depth=0"],
      { timeout: 10_000, shell: isWin },
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

export async function runUpdate(
  configPath: string,
  verbosity = 0,
  opts: { force?: boolean; yes?: boolean } = {},
): Promise<void> {
  const out = createOut(verbosity);
  const cwd = process.cwd();

  const hasPackageJson = existsSync(join(cwd, "package.json"));
  const hasVirageConfig = existsSync(configPath);

  if (!hasPackageJson && !hasVirageConfig) {
    out.warn(`No config file found at ${configPath}.`);
    out.dim("Run `virage init` first to configure your project.");
    return;
  }

  const isGlobal = !hasPackageJson;
  if (isGlobal) {
    out.dim(
      "(No package.json found — treating as standalone project, will install globally.)",
    );
  }

  out.section("Virage Update");
  out.dim("Discovering virage ecosystem packages...");

  const packageNames = await discoverViragePackages(cwd, configPath, isGlobal);

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
    out.success("All virage packages are up to date.");
  } else {
    out.info(`\nFound ${outdated.length} outdated package(s):`);
    for (const s of outdated) {
      out.dim(`  ${s.name}: ${s.current} → ${s.latest}`);
    }
  }
  if (unknownLatest.length > 0) {
    out.warn(
      `Could not fetch latest version for ${unknownLatest.length} package(s) (registry unreachable?):`,
    );
    for (const s of unknownLatest) {
      out.dim(`  ${s.name}: ${s.current}`);
    }
  }

  if (statuses.length === 0) {
    out.warn("No virage packages to update.");
    return;
  }

  // Let user pick which packages to update (skipped with --yes)
  let toUpdate: string[];
  if (opts.yes) {
    toUpdate = statuses.map((s) => s.name);
    out.dim("Updating all packages (--yes).");
  } else {
    toUpdate = await checkbox({
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
  }

  if (toUpdate.length > 0) {
    const pm = await detectPackageManager(cwd);
    const forceArgs = opts.force ? ["--force"] : [];

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
      const localPluginDir = getLocalPluginDir(cwd);
      await mkdir(localPluginDir, { recursive: true });
      const { cmd, args } = buildPluginPrefixInstallCommand(
        localPluginPkgs,
        localPluginDir,
      );
      const fullArgs = [...args, ...forceArgs];
      out.dim(`\nRunning: ${cmd} ${fullArgs.join(" ")}`);
      try {
        await runInstall(cmd, fullArgs);
      } catch {
        out.error("Local plugin update failed. Try running manually:");
        out.dim(`  ${cmd} ${fullArgs.join(" ")}`);
        updateFailed = true;
      }
    }

    if (globalPluginPkgs.length > 0) {
      const globalPluginDir = getGlobalPluginDir();
      await mkdir(globalPluginDir, { recursive: true });
      const { cmd, args } = buildPluginPrefixInstallCommand(
        globalPluginPkgs,
        globalPluginDir,
      );
      const fullArgs = [...args, ...forceArgs];
      out.dim(`\nRunning: ${cmd} ${fullArgs.join(" ")}`);
      try {
        await runInstall(cmd, fullArgs);
      } catch {
        out.error("Global plugin update failed. Try running manually:");
        out.dim(`  ${cmd} ${fullArgs.join(" ")}`);
        updateFailed = true;
      }
    }

    if (nodeModulesPkgs.length > 0) {
      const { cmd, args } = isGlobal
        ? buildGlobalInstallCommand(pm, nodeModulesPkgs)
        : buildInstallCommand(pm, nodeModulesPkgs);
      const fullArgs = [...args, ...forceArgs];
      out.dim(`\nRunning: ${cmd} ${fullArgs.join(" ")}`);
      try {
        await runInstall(cmd, fullArgs);
      } catch {
        out.error("Update failed. Try running manually:");
        out.dim(`  ${cmd} ${fullArgs.join(" ")}`);
        updateFailed = true;
      }
    }

    if (!updateFailed) {
      out.success("Packages updated successfully.");

      // Rewrite pluginVersions in virage config for plugin-dir packages
      if (existsSync(configPath)) {
        try {
          const raw = await readFile(configPath, "utf-8");
          const cfg = JSON.parse(raw) as Record<string, unknown>;
          const existingVersions =
            (cfg.pluginVersions as Record<string, string> | undefined) ?? {};
          for (const s of selectedStatuses) {
            if (
              s.location === "local-plugin" ||
              s.location === "global-plugin" ||
              s.name in existingVersions
            ) {
              existingVersions[s.name] = `~${s.latest}`;
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
    out.dim("\nSyncing agent plugin configs...");
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
        out.dim(`  ${plugin.label}: ${msg}${mcpMsg}`);
      } catch (err) {
        out.warn(
          `  ${plugin.label} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Self-update @vivantel/virage-cli in global npm if globally installed
  try {
    const { stdout: listOut } = await execFileAsync(
      npmBin,
      ["list", "-g", "--depth=0", "--json"],
      { timeout: 10_000, shell: isWin },
    );
    const listed = JSON.parse(listOut) as {
      dependencies?: Record<string, { version?: string }>;
    };
    const cliEntry = listed.dependencies?.["@vivantel/virage-cli"];
    if (cliEntry) {
      const currentCliVersion = cliEntry.version ?? "unknown";
      const latestCliVersion = await getLatestVersion("@vivantel/virage-cli");
      if (latestCliVersion && currentCliVersion !== latestCliVersion) {
        out.dim(
          `\nUpdating @vivantel/virage-cli: ${currentCliVersion} → ${latestCliVersion}`,
        );
        await runInstall("npm", [
          "install",
          "-g",
          "@vivantel/virage-cli@latest",
        ]);
        out.dim("  CLI updated. New version active on next invocation.");
      } else {
        out.dim("\n@vivantel/virage-cli is up to date.");
      }
    }
  } catch {
    // Non-fatal: CLI self-update is best-effort
  }

  // Auto-sync skills if available — no interactive prompt needed
  const skillsPkgPath = resolveSkillsPackagePath();
  if (skillsPkgPath !== null) {
    out.dim("\nSyncing Virage AI agent skills...");
    try {
      const result = await syncSkills(skillsPkgPath, cwd);
      if (result.created.length > 0)
        out.dim(`  Skills installed: ${result.created.length} new`);
      if (result.updated.length > 0)
        out.dim(`  Skills updated: ${result.updated.length}`);
      if (result.deleted.length > 0)
        out.dim(`  Skills removed: ${result.deleted.length}`);
      if (
        result.created.length === 0 &&
        result.updated.length === 0 &&
        result.deleted.length === 0
      )
        out.dim("  Already up to date.");
    } catch (err) {
      out.warn(
        `  Skills sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  out.success("Done.");
}

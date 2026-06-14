import { checkbox, select } from "@inquirer/prompts";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { discoverAgentPlugins, runAgentPlugin } from "./agent-plugin.js";
import { resolveSkillsPackagePath, syncSkills } from "./skills.js";
import {
  detectPackageManager,
  buildInstallCommand,
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

async function discoverViragePackages(cwd: string): Promise<string[]> {
  const projectPkg = await readProjectPackageJson(cwd);
  if (!projectPkg) return [];

  const allDeps = {
    ...projectPkg.dependencies,
    ...projectPkg.devDependencies,
  };

  const candidates = new Set<string>();

  for (const pkgName of Object.keys(allDeps)) {
    // Include all @vivantel/* packages
    if (pkgName.startsWith("@vivantel/")) {
      candidates.add(pkgName);
      continue;
    }

    // Include any package that declares a rag-plugin or virage-agent field
    const depPkg = await readNodeModulePackageJson(cwd, pkgName);
    if (depPkg && (depPkg["rag-plugin"] || depPkg["virage-agent"])) {
      candidates.add(pkgName);
    }
  }

  return Array.from(candidates);
}

async function getLatestVersion(packageName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("npm", [
      "view",
      packageName,
      "version",
      "--json",
    ]);
    return (JSON.parse(stdout.trim()) as string).trim();
  } catch {
    return null;
  }
}

async function getCurrentVersion(
  cwd: string,
  packageName: string,
): Promise<string | null> {
  const pkg = await readNodeModulePackageJson(cwd, packageName);
  return pkg?.version ?? null;
}

interface PackageStatus {
  name: string;
  current: string;
  latest: string;
  outdated: boolean;
}

export async function runUpdate(): Promise<void> {
  const cwd = process.cwd();

  console.log("\nVirage Update\n");
  console.log("Discovering virage ecosystem packages...");

  const packageNames = await discoverViragePackages(cwd);

  if (packageNames.length === 0) {
    console.log(
      "\nNo virage packages found in package.json. Run `virage init` first.\n",
    );
    return;
  }

  // Fetch current and latest versions in parallel
  const statuses = await Promise.all(
    packageNames.map(async (name): Promise<PackageStatus> => {
      const [current, latest] = await Promise.all([
        getCurrentVersion(cwd, name),
        getLatestVersion(name),
      ]);
      const cur = current ?? "unknown";
      const lat = latest ?? "unknown";
      return { name, current: cur, latest: lat, outdated: cur !== lat };
    }),
  );

  const outdated = statuses.filter((s) => s.outdated);

  if (outdated.length === 0) {
    console.log("\nAll virage packages are up to date.\n");
  } else {
    console.log(`\nFound ${outdated.length} outdated package(s):`);
    for (const s of outdated) {
      console.log(`  ${s.name}: ${s.current} → ${s.latest}`);
    }
  }

  // Let user pick which packages to update
  const toUpdate = await checkbox({
    message: "Select packages to update:",
    choices: statuses.map((s) => ({
      name: s.outdated
        ? `${s.name}  (${s.current} → ${s.latest})`
        : `${s.name}  (${s.current}, up to date)`,
      value: s.name,
      checked: s.outdated,
    })),
  });

  if (toUpdate.length > 0) {
    const pm = await detectPackageManager(cwd);
    // Build install@latest commands
    const latestPackages = toUpdate.map((n) => `${n}@latest`);
    const { cmd, args } = buildInstallCommand(pm, latestPackages);
    console.log(`\nRunning: ${cmd} ${args.join(" ")}`);
    try {
      await runInstall(cmd, args);
      console.log("\nPackages updated successfully.");
    } catch {
      console.log("\nUpdate failed. Try running manually:");
      console.log(`  ${cmd} ${args.join(" ")}`);
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

  // Offer to re-sync skills
  const skillsPkgPath = resolveSkillsPackagePath();
  if (skillsPkgPath !== null) {
    const syncChoice = await select({
      message: "Re-sync Virage AI agent skills?",
      choices: [
        { name: "Yes — update .agents/skills/virage/", value: true },
        { name: "No, skip", value: false },
      ],
    });
    if (syncChoice) {
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
          `\nSkills sync failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  console.log("\nDone.\n");
}

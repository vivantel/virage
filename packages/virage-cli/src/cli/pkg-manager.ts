import { existsSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { execFileSync, spawn } from "child_process";

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

export async function detectPackageManager(
  projectRoot: string,
): Promise<PackageManager> {
  if (existsSync(join(projectRoot, "bun.lockb"))) return "bun";
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectRoot, "yarn.lock"))) return "yarn";
  return "npm";
}

export function buildInstallCommand(
  pm: PackageManager,
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

export function buildGlobalInstallCommand(
  pm: PackageManager,
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

// ─── Plugin directory helpers ─────────────────────────────────────────────────

export function getLocalPluginDir(configDir: string): string {
  return join(configDir, ".virage", "plugins");
}

export function getGlobalPluginDir(): string {
  return join(homedir(), ".virage", "plugins");
}

export function getPluginDirForConfig(configPath: string): string {
  return getLocalPluginDir(dirname(configPath));
}

// Plugin installs always use npm --prefix regardless of project package manager,
// so the plugin dir is a self-contained node_modules tree independent of project deps.
export function buildPluginPrefixInstallCommand(
  packages: string[],
  prefixDir: string,
): { cmd: string; args: string[] } {
  return {
    cmd: "npm",
    args: ["install", "--prefix", prefixDir, ...packages],
  };
}

export async function fetchLatestVersion(pkg: string): Promise<string> {
  try {
    const version = execFileSync("npm", ["view", pkg, "version"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return version;
  } catch {
    return "latest";
  }
}

export function runInstall(cmd: string, args: string[]): Promise<void> {
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

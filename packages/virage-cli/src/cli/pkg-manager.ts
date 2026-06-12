import { existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";

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

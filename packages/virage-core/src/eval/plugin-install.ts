import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Install pinned packages into `pluginDir/node_modules`.
 * No-op if `pluginDir/node_modules` already exists (idempotent).
 * The dir is content-addressed by the caller.
 */
export async function ensurePluginsInstalled(
  pluginVersions: Record<string, string>,
  pluginDir: string,
): Promise<void> {
  if (Object.keys(pluginVersions).length === 0) return;
  if (existsSync(join(pluginDir, "node_modules"))) return;

  await mkdir(pluginDir, { recursive: true });

  const packages = Object.entries(pluginVersions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pkg, version]) => `${pkg}@${version}`);

  const isWin = process.platform === "win32";
  execFileSync(
    isWin ? "npm.cmd" : "npm",
    ["install", "--prefix", pluginDir, ...packages],
    {
      stdio: "inherit",
      shell: isWin,
    },
  );
}

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Install pinned packages into `pluginDir/node_modules`.
 * No-op if `pluginDir/node_modules` already exists (idempotent).
 * The dir is content-addressed by the caller.
 *
 * @param showOutput When true, npm output flows to the terminal (useful at high verbosity).
 *                   When false (default), npm output is suppressed; stderr is captured and
 *                   included in any thrown error.
 */
export async function ensurePluginsInstalled(
  pluginVersions: Record<string, string>,
  pluginDir: string,
  showOutput = false,
): Promise<void> {
  if (Object.keys(pluginVersions).length === 0) return;
  if (existsSync(join(pluginDir, "node_modules"))) return;

  await mkdir(pluginDir, { recursive: true });

  const packages = Object.entries(pluginVersions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pkg, version]) => `${pkg}@${version}`);

  const isWin = process.platform === "win32";
  // When suppressing output, ignore stdout (large) to avoid spawnSync buffer
  // overflow; pipe stderr so errors can be included in thrown messages.
  const stdio = showOutput
    ? ("inherit" as const)
    : (["pipe", "ignore", "pipe"] as ["pipe", "ignore", "pipe"]);

  const result = spawnSync(
    isWin ? "npm.cmd" : "npm",
    ["install", "--prefix", pluginDir, ...packages],
    { stdio, shell: isWin },
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() ?? "";
    throw new Error(
      `npm install failed (exit ${result.status ?? "?"})` +
        (stderr ? `:\n${stderr}` : ""),
    );
  }
}

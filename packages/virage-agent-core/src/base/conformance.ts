import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";

/**
 * Retrieval contract v0 conformance detection.
 *
 * Mirrors `isConformanceMode` in `@vivantel/virage-core`; this package has no
 * runtime dependencies, so the few lines are repeated rather than imported.
 * An explicit boolean `retrieval.conformance` in the config wins; otherwise
 * the mode is on when the host's policy file exists.
 */
export const RETRIEVAL_POLICY_PATH = ".go-getter/retrieval/policy.json";

export async function isConformanceMode(targetDir: string): Promise<boolean> {
  const configPath = join(targetDir, "virage.config.json");
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(await readFile(configPath, "utf-8")) as {
        retrieval?: { conformance?: unknown };
      };
      const flag = cfg.retrieval?.conformance;
      if (typeof flag === "boolean") return flag;
    } catch {
      // Unparseable config: fall through to policy-file detection.
    }
  }
  return existsSync(join(targetDir, RETRIEVAL_POLICY_PATH));
}

/**
 * Plugin-config files that register a hook or an MCP server with the host.
 * Conformance mode never copies them.
 */
export function isHostConfigFile(relPath: string): boolean {
  const posix = relPath.replace(/\\/g, "/");
  return (
    posix === "hooks.json" ||
    posix === ".mcp.json" ||
    posix === ".claude-plugin/plugin.json"
  );
}

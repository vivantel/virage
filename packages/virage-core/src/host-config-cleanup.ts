import { existsSync } from "fs";
import { readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { declarationPath } from "./retrieval-contract.js";

/**
 * Remove the host registrations virage wrote, for `virage uninstall`:
 *
 * - the `virage` entry (and the older `virage-agent` name) in `.mcp.json`;
 * - the hooks virage wrote to `.claude/settings.json` (the `inject-context`
 *   UserPromptSubmit hook and anything carrying virage's `[Virage]` marker);
 * - the retrieval declaration `.go-getter/retrieval/virage.json`.
 *
 * Only virage's own entries are touched: every other server, hook and key is
 * kept in place and in order. A file that cannot be parsed is left alone.
 * Mirrors `crates/virage-engine/src/retrieval/host_config.rs`.
 */

/** Names virage has registered its MCP server under. */
const VIRAGE_MCP_NAMES = ["virage", "virage-agent"];

/** Marker virage puts in the command or status message of hooks it manages. */
const HOOK_MARKER = "[Virage]";

export interface HostConfigRemoval {
  /** MCP server names removed from `.mcp.json`. */
  mcpEntries: string[];
  /** Hook entries removed from `.claude/settings.json`. */
  hooks: number;
  /** Whether `.go-getter/retrieval/virage.json` was (or would be) removed. */
  declaration: boolean;
  /** Project-relative files that exist but could not be parsed (left untouched). */
  unreadable: string[];
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Is this hook entry one virage wrote? */
export function isVirageHook(hook: unknown): boolean {
  if (!isObject(hook)) return false;
  const command = typeof hook["command"] === "string" ? hook["command"] : "";
  const message =
    typeof hook["statusMessage"] === "string" ? hook["statusMessage"] : "";
  return (
    command.includes(HOOK_MARKER) ||
    message.includes(HOOK_MARKER) ||
    (command.includes("inject-context") && command.includes("virage"))
  );
}

/** Remove virage's MCP servers from a parsed `.mcp.json`. Returns the names removed. */
export function stripMcpEntries(config: Json): string[] {
  const servers = config["mcpServers"];
  if (!isObject(servers)) return [];
  const removed: string[] = [];
  for (const name of VIRAGE_MCP_NAMES) {
    if (name in servers) {
      delete servers[name];
      removed.push(name);
    }
  }
  if (removed.length > 0 && Object.keys(servers).length === 0) {
    delete config["mcpServers"];
  }
  return removed;
}

/**
 * Remove virage's hooks from parsed Claude Code settings. Returns how many
 * hook entries were removed. Containers that become empty because of the
 * removal are pruned; everything else is left as it was.
 */
export function stripVirageHooks(settings: Json): number {
  const hooks = settings["hooks"];
  if (!isObject(hooks)) return 0;
  let removed = 0;
  for (const event of Object.keys(hooks)) {
    const matchers = hooks[event];
    if (!Array.isArray(matchers)) continue;
    const kept: unknown[] = [];
    for (const matcher of matchers) {
      if (!isObject(matcher) || !Array.isArray(matcher["hooks"])) {
        kept.push(matcher);
        continue;
      }
      const before = matcher["hooks"].length;
      const remaining = matcher["hooks"].filter((h) => !isVirageHook(h));
      const dropped = before - remaining.length;
      removed += dropped;
      if (dropped === 0) {
        kept.push(matcher);
      } else if (remaining.length > 0) {
        kept.push({ ...matcher, hooks: remaining });
      }
    }
    if (
      kept.length === matchers.length &&
      kept.every((m, i) => m === matchers[i])
    ) {
      continue;
    }
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (removed > 0 && Object.keys(hooks).length === 0) {
    delete settings["hooks"];
  }
  return removed;
}

async function readJson(path: string): Promise<Json | "unreadable" | null> {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf-8"));
    return isObject(parsed) ? parsed : "unreadable";
  } catch {
    return "unreadable";
  }
}

/**
 * Remove virage's host registrations from a project. With `dryRun` nothing is
 * written; the result says what would be removed.
 */
export async function removeHostRegistrations(
  projectDir: string,
  opts: { dryRun?: boolean } = {},
): Promise<HostConfigRemoval> {
  const result: HostConfigRemoval = {
    mcpEntries: [],
    hooks: 0,
    declaration: false,
    unreadable: [],
  };

  const mcpPath = join(projectDir, ".mcp.json");
  const mcp = await readJson(mcpPath);
  if (mcp === "unreadable") {
    result.unreadable.push(".mcp.json");
  } else if (mcp) {
    result.mcpEntries = stripMcpEntries(mcp);
    if (result.mcpEntries.length > 0 && !opts.dryRun) {
      await writeFile(mcpPath, JSON.stringify(mcp, null, 2) + "\n");
    }
  }

  const settingsPath = join(projectDir, ".claude", "settings.json");
  const settings = await readJson(settingsPath);
  if (settings === "unreadable") {
    result.unreadable.push(".claude/settings.json");
  } else if (settings) {
    result.hooks = stripVirageHooks(settings);
    if (result.hooks > 0 && !opts.dryRun) {
      await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    }
  }

  const decl = declarationPath(projectDir);
  if (existsSync(decl)) {
    result.declaration = true;
    if (!opts.dryRun) await rm(decl, { force: true });
  }

  return result;
}

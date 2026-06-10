import { createRequire } from "module";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";

export interface AgentConfigResult {
  hooksWritten: boolean;
  mcpRegistered: boolean;
}

interface HooksEntry {
  type: "command";
  command: string;
  statusMessage?: string;
}

interface HooksMatcher {
  matcher: string;
  hooks: HooksEntry[];
}

interface HooksConfig {
  version: string;
  hooks: {
    PreToolUse: HooksMatcher[];
    PostToolUse: HooksMatcher[];
  };
}

interface ClaudeSettings {
  hooks?: {
    PreToolUse?: HooksMatcher[];
    PostToolUse?: HooksMatcher[];
  };
  [key: string]: unknown;
}

interface McpConfig {
  mcpServers?: Record<
    string,
    {
      type: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
  [key: string]: unknown;
}

function resolveSkillsPackagePath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve("@vivantel/virage-skills/package.json");
    return dirname(pkgJsonPath);
  } catch {
    return null;
  }
}

async function readHooksConfig(): Promise<HooksConfig | null> {
  const skillsPkgPath = resolveSkillsPackagePath();
  if (!skillsPkgPath) return null;
  try {
    const raw = await readFile(
      join(skillsPkgPath, "agent-config", "hooks.json"),
      "utf-8",
    );
    return JSON.parse(raw) as HooksConfig;
  } catch {
    return null;
  }
}

async function mergeHooks(
  hooksConfig: HooksConfig,
  targetDir: string,
): Promise<boolean> {
  const settingsDir = join(targetDir, ".claude");
  const settingsPath = join(settingsDir, "settings.json");

  let settings: ClaudeSettings = { hooks: { PreToolUse: [], PostToolUse: [] } };

  if (existsSync(settingsPath)) {
    try {
      const raw = await readFile(settingsPath, "utf-8");
      settings = JSON.parse(raw) as ClaudeSettings;
    } catch {
      process.stderr.write(
        `Warning: Could not parse ${settingsPath} — skipping hook merge.\n`,
      );
      return false;
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

  let written = false;

  for (const event of ["PreToolUse", "PostToolUse"] as const) {
    for (const incoming of hooksConfig.hooks[event]) {
      const existing = settings.hooks[event]!.find(
        (m) => m.matcher === incoming.matcher,
      );
      if (existing) {
        for (const hook of incoming.hooks) {
          const alreadyPresent = existing.hooks.some(
            (h) => h.command === hook.command,
          );
          if (!alreadyPresent) {
            existing.hooks.push(hook);
            written = true;
          }
        }
      } else {
        settings.hooks[event]!.push(incoming);
        written = true;
      }
    }
  }

  if (written) {
    await mkdir(settingsDir, { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }

  return written;
}

async function mergeMcpServer(targetDir: string): Promise<boolean> {
  const mcpPath = join(targetDir, ".mcp.json");

  let config: McpConfig = {};

  if (existsSync(mcpPath)) {
    try {
      const raw = await readFile(mcpPath, "utf-8");
      config = JSON.parse(raw) as McpConfig;
    } catch {
      process.stderr.write(
        `Warning: Could not parse ${mcpPath} — skipping MCP registration.\n`,
      );
      return false;
    }
  }

  if (!config.mcpServers) config.mcpServers = {};

  if (config.mcpServers["virage-agent"]) {
    return false;
  }

  config.mcpServers["virage-agent"] = {
    type: "stdio",
    command: "npx",
    args: ["-y", "@vivantel/virage-agent-claude"],
  };

  await writeFile(mcpPath, JSON.stringify(config, null, 2) + "\n");
  return true;
}

export async function configure(
  targetDir: string = process.cwd(),
): Promise<AgentConfigResult> {
  const hooksConfig = await readHooksConfig();

  const hooksWritten = hooksConfig
    ? await mergeHooks(hooksConfig, targetDir)
    : false;

  const mcpRegistered = await mergeMcpServer(targetDir);

  return { hooksWritten, mcpRegistered };
}

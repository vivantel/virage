import { createRequire } from "module";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import {
  BaseAgentPlugin,
  CLAUDE_VENDOR_CONFIG,
} from "@vivantel/virage-agent-core";
import type {
  AgentConfigResult,
  AgentHooksConfig,
} from "@vivantel/virage-agent-core";

// ── Internal Claude-specific config shapes ────────────────────────────────────

interface HooksMatcher {
  matcher: string;
  hooks: { type: "command"; command: string; statusMessage?: string }[];
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

// ── ClaudeAgentPlugin ─────────────────────────────────────────────────────────

export class ClaudeAgentPlugin extends BaseAgentPlugin {
  readonly name = "claude-code";
  readonly label = "Claude Code";
  readonly vendorConfig = CLAUDE_VENDOR_CONFIG;

  async configure(
    targetDir: string = process.cwd(),
  ): Promise<AgentConfigResult> {
    const hooksConfig = await this.readHooksConfig();

    const hooksWritten = hooksConfig
      ? await this.mergeHooks(hooksConfig, targetDir)
      : false;

    const mcpRegistered = await this.mergeMcpServer(targetDir);

    return { hooksWritten, mcpRegistered };
  }

  private resolveSkillsPackagePath(): string | null {
    try {
      const require = createRequire(import.meta.url);
      const pkgJsonPath =
        require.resolve("@vivantel/virage-skills/package.json");
      return dirname(pkgJsonPath);
    } catch {
      return null;
    }
  }

  private async readHooksConfig(): Promise<AgentHooksConfig | null> {
    const skillsPkgPath = this.resolveSkillsPackagePath();
    if (!skillsPkgPath) return null;
    try {
      const raw = await readFile(
        join(skillsPkgPath, "agent-config", "hooks.json"),
        "utf-8",
      );
      return JSON.parse(raw) as AgentHooksConfig;
    } catch {
      return null;
    }
  }

  private async mergeHooks(
    hooksConfig: AgentHooksConfig,
    targetDir: string,
  ): Promise<boolean> {
    const settingsDir = join(targetDir, ".claude");
    const settingsPath = join(settingsDir, "settings.json");

    let settings: ClaudeSettings = {
      hooks: { PreToolUse: [], PostToolUse: [] },
    };

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
      const incoming = hooksConfig.hooks[event] ?? [];
      for (const matcher of incoming) {
        if (!matcher.matcher) continue;
        const existing = settings.hooks[event]!.find(
          (m) => m.matcher === matcher.matcher,
        );
        if (existing) {
          for (const hook of matcher.hooks) {
            const alreadyPresent = existing.hooks.some(
              (h) => h.command === hook.command,
            );
            if (!alreadyPresent) {
              existing.hooks.push(hook);
              written = true;
            }
          }
        } else {
          settings.hooks[event]!.push({
            matcher: matcher.matcher,
            hooks: matcher.hooks,
          });
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

  private async mergeMcpServer(targetDir: string): Promise<boolean> {
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
}

// ── Module-level exports for virage-cli compatibility ─────────────────────────

export type { AgentConfigResult };

const plugin = new ClaudeAgentPlugin();
export const configure = plugin.configure.bind(plugin);

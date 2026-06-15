import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import {
  BaseAgentPlugin,
  CLAUDE_VENDOR_CONFIG,
} from "@vivantel/virage-agent-core";
import type { AgentConfigResult } from "@vivantel/virage-agent-core";

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

interface HookEntry {
  type: string;
  command: string;
  statusMessage?: string;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

const VIRAGE_HOOK_MARKER = "[Virage]";

const VIRAGE_HOOKS: Record<string, HookMatcher[]> = {
  UserPromptSubmit: [
    {
      hooks: [
        {
          type: "command",
          command: [
            "prompt=$(cat);",
            `if echo "$prompt" | grep -qiE '\\b(plan|break.?down|roadmap|sequence|implement.?steps)\\b'; then`,
            `  echo '${VIRAGE_HOOK_MARKER} Task matches planner skill (~1932 tokens). Call read_skill_summary("planner") to check fit, or read_skill("planner") for the full workflow.';`,
            `elif echo "$prompt" | grep -qiE '\\b(ADR|architect|interface.?design|system.?design|refactor.?scope)\\b'; then`,
            `  echo '${VIRAGE_HOOK_MARKER} Task matches architect skill (~1854 tokens). Call read_skill_summary("architect") to check fit.';`,
            `elif echo "$prompt" | grep -qiE '\\b(docs?|README|CHANGELOG|document|write.?up)\\b'; then`,
            `  echo '${VIRAGE_HOOK_MARKER} Task matches doc_writer skill (~807 tokens). Call read_skill_summary("doc_writer") to check fit.';`,
            `elif echo "$prompt" | grep -qiE '\\b(review|security|vulnerabilit|audit)\\b'; then`,
            `  echo '${VIRAGE_HOOK_MARKER} Task matches code-guardian skill (~2012 tokens). Call read_skill_summary("code-guardian") to check fit.';`,
            `fi`,
          ].join(" "),
          statusMessage: "Checking for skill suggestions...",
        },
      ],
    },
  ],
  PreToolUse: [
    {
      matcher: "Bash(grep -r*)",
      hooks: [
        {
          type: "command",
          command: `echo '${VIRAGE_HOOK_MARKER} Filesystem search detected. Consider mcp__virage__search for semantic search over indexed content — more targeted and token-efficient for codebase questions.'`,
          statusMessage: "Suggesting Virage RAG for search...",
        },
      ],
    },
    {
      matcher: "Bash(find . *)",
      hooks: [
        {
          type: "command",
          command: `echo '${VIRAGE_HOOK_MARKER} Broad find detected. Consider mcp__virage__search or mcp__virage__list_source_files for indexed content discovery.'`,
          statusMessage: "Suggesting Virage RAG for file discovery...",
        },
      ],
    },
  ],
};

export class ClaudeAgentPlugin extends BaseAgentPlugin {
  readonly name = "claude-code";
  readonly label = "Claude Code";
  readonly vendorConfig = CLAUDE_VENDOR_CONFIG;

  async configure(
    targetDir: string = process.cwd(),
  ): Promise<AgentConfigResult> {
    const base = await super.configure(targetDir);
    const mcpRegistered = await this.mergeMcpServer(targetDir);
    await this.mergeHooks(targetDir);
    return { ...base, mcpRegistered };
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

    const desired = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@vivantel/virage-agent-claude@latest"],
    };
    const alreadyCurrent =
      JSON.stringify(config.mcpServers["virage"]) === JSON.stringify(desired);
    const hasStale = !!config.mcpServers["virage-agent"];

    if (alreadyCurrent && !hasStale) return false;

    config.mcpServers["virage"] = desired;
    delete config.mcpServers["virage-agent"];

    await writeFile(mcpPath, JSON.stringify(config, null, 2) + "\n");
    return true;
  }

  private async mergeHooks(targetDir: string): Promise<void> {
    const settingsPath = join(targetDir, ".claude", "settings.json");

    let settings: ClaudeSettings = {};
    if (existsSync(settingsPath)) {
      try {
        const raw = await readFile(settingsPath, "utf-8");
        settings = JSON.parse(raw) as ClaudeSettings;
      } catch {
        return;
      }
    }

    if (!settings.hooks) settings.hooks = {};

    let changed = false;
    for (const [event, matchers] of Object.entries(VIRAGE_HOOKS)) {
      if (!settings.hooks[event]) settings.hooks[event] = [];
      const existing = settings.hooks[event];

      for (const matcher of matchers) {
        const alreadyPresent = existing.some((m) =>
          m.hooks.some((h) => h.command.includes(VIRAGE_HOOK_MARKER)),
        );
        if (!alreadyPresent) {
          existing.push(matcher);
          changed = true;
        }
      }
    }

    if (changed) {
      await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    }
  }
}

export type { AgentConfigResult };

const plugin = new ClaudeAgentPlugin();
export const configure = plugin.configure.bind(plugin);

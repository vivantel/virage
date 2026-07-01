import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
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
            `  npx virage read-skill-summary planner 2>/dev/null || true;`,
            `elif echo "$prompt" | grep -qiE '\\b(ADR|architect|interface.?design|system.?design|refactor.?scope)\\b'; then`,
            `  npx virage read-skill-summary architect 2>/dev/null || true;`,
            `elif echo "$prompt" | grep -qiE '\\b(docs?|README|CHANGELOG|document|write.?up)\\b'; then`,
            `  npx virage read-skill-summary doc-writer 2>/dev/null || true;`,
            `elif echo "$prompt" | grep -qiE '\\b(review|security|vulnerabilit|audit)\\b'; then`,
            `  npx virage read-skill-summary code-guard 2>/dev/null || true;`,
            `fi;`,
            `EXCERPT=$(echo "$prompt" | head -c 400);`,
            `RAG=$(npx virage query "$EXCERPT" --json --top-k 3 2>/dev/null || echo "");`,
            `if [ -n "$RAG" ] && [ "$RAG" != "[]" ]; then`,
            `  node -e "const r=JSON.parse(process.argv[1]);if(!r||!r.length)process.exit(0);process.stdout.write(['\\n# Virage RAG Context\\n'].concat(r.map(c=>'## '+(c.sourceFile||'?')+'\\n'+c.denseText.slice(0,600)+'\\n')).join('\\n'))" "$RAG" 2>/dev/null || true;`,
            `fi`,
          ].join(" "),
          statusMessage: "[Virage] Loading skill summary...",
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

  private isMcpEntryCurrent(
    entry: { type?: string; command?: string; args?: string[] } | undefined,
  ): boolean {
    return (
      entry?.type === "stdio" &&
      entry?.command === "npx" &&
      JSON.stringify(entry?.args) ===
        JSON.stringify(["-y", "@vivantel/virage-agent-claude@latest"])
    );
  }

  private async mergeMcpServer(targetDir: string): Promise<boolean> {
    // Check .mcp.json before invoking `claude mcp add` — if the entry is
    // already current we have nothing to do and should return false.
    // Note: `claude mcp add` may write extra fields (e.g. `"env": {}`) so
    // we compare essential fields individually rather than full JSON equality.
    const mcpPath = join(targetDir, ".mcp.json");
    if (existsSync(mcpPath)) {
      try {
        const raw = await readFile(mcpPath, "utf-8");
        const config = JSON.parse(raw) as McpConfig;
        const hasStale = !!config.mcpServers?.["virage-agent"];
        if (
          this.isMcpEntryCurrent(config.mcpServers?.["virage"]) &&
          !hasStale
        ) {
          return false;
        }
      } catch {
        // Unparseable .mcp.json — fall through to re-register.
      }
    }

    try {
      await execFileAsync(
        "claude",
        [
          "mcp",
          "add",
          "virage",
          "--scope",
          "project",
          "--",
          "npx",
          "-y",
          "@vivantel/virage-agent-claude@latest",
        ],
        { cwd: targetDir },
      );
      return true;
    } catch {
      return this.mergeMcpServerFallback(targetDir);
    }
  }

  private async mergeMcpServerFallback(targetDir: string): Promise<boolean> {
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

    const hasStale = !!config.mcpServers["virage-agent"];
    if (this.isMcpEntryCurrent(config.mcpServers["virage"]) && !hasStale)
      return false;

    config.mcpServers["virage"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@vivantel/virage-agent-claude@latest"],
    };
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

    const before = JSON.stringify(settings.hooks);

    // Strip all Virage-managed entries from every event (handles removals and updates)
    for (const event of Object.keys(settings.hooks)) {
      settings.hooks[event] = settings.hooks[event].filter(
        (m) =>
          !m.hooks.some(
            (h) =>
              h.command.includes(VIRAGE_HOOK_MARKER) ||
              h.statusMessage?.includes(VIRAGE_HOOK_MARKER),
          ),
      );
    }

    // Re-inject current VIRAGE_HOOKS
    for (const [event, matchers] of Object.entries(VIRAGE_HOOKS)) {
      if (!settings.hooks[event]) settings.hooks[event] = [];
      settings.hooks[event].push(...matchers);
    }

    if (JSON.stringify(settings.hooks) !== before) {
      await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    }
  }
}

export type { AgentConfigResult };

const plugin = new ClaudeAgentPlugin();
export const configure = plugin.configure.bind(plugin);

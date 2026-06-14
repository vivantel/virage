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

export class ClaudeAgentPlugin extends BaseAgentPlugin {
  readonly name = "claude-code";
  readonly label = "Claude Code";
  readonly vendorConfig = CLAUDE_VENDOR_CONFIG;

  async configure(
    targetDir: string = process.cwd(),
  ): Promise<AgentConfigResult> {
    const base = await super.configure(targetDir);
    const mcpRegistered = await this.mergeMcpServer(targetDir);
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
}

export type { AgentConfigResult };

const plugin = new ClaudeAgentPlugin();
export const configure = plugin.configure.bind(plugin);

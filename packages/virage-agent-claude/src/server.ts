import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createRequire } from "module";
import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { configure } from "./plugin.js";

function resolveSkillsPackagePath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve("@vivantel/virage-skills/package.json");
    return dirname(pkgJsonPath);
  } catch {
    return null;
  }
}

async function listSkillNames(skillsRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(skillsRoot, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && existsSync(join(skillsRoot, e.name, "SKILL.md")))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export function createAgentMcpServer(): McpServer {
  const server = new McpServer({ name: "virage-agent", version: "0.1.0" });

  server.tool(
    "list_skills",
    "List all available Virage agent skills by name.",
    {},
    async () => {
      const pkgPath = resolveSkillsPackagePath();
      if (!pkgPath) {
        return {
          content: [
            {
              type: "text",
              text: "Error: @vivantel/virage-skills package not found.",
            },
          ],
        };
      }
      const names = await listSkillNames(join(pkgPath, "skills"));
      return {
        content: [{ type: "text", text: JSON.stringify(names, null, 2) }],
      };
    },
  );

  server.tool(
    "read_skill",
    "Read the SKILL.md content for a named Virage agent skill.",
    { name: z.string().describe("Skill name, e.g. 'planner' or 'architect'") },
    async ({ name }) => {
      const pkgPath = resolveSkillsPackagePath();
      if (!pkgPath) {
        return {
          content: [
            {
              type: "text",
              text: "Error: @vivantel/virage-skills package not found.",
            },
          ],
        };
      }
      const skillPath = join(pkgPath, "skills", name, "SKILL.md");
      try {
        const content = await readFile(skillPath, "utf-8");
        return { content: [{ type: "text", text: content }] };
      } catch {
        return {
          content: [
            { type: "text", text: `Skill '${name}' not found.` },
          ],
        };
      }
    },
  );

  server.tool(
    "onboard",
    "Configure Claude Code hooks and MCP server registration for Virage in the current project. Call this once in a new project to self-configure.",
    {
      targetDir: z
        .string()
        .optional()
        .describe("Project root directory (defaults to cwd)"),
    },
    async ({ targetDir }) => {
      const dir = targetDir ?? process.cwd();
      try {
        const result = await configure(dir);
        const lines: string[] = [];
        lines.push(
          result.hooksWritten
            ? "Claude Code hooks written to .claude/settings.json"
            : "Claude Code hooks already present (no changes)",
        );
        lines.push(
          result.mcpRegistered
            ? "MCP server registered in .mcp.json"
            : "MCP server entry already present in .mcp.json (no changes)",
        );
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error during onboarding: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  return server;
}

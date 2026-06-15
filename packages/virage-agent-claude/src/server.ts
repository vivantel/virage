import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createRequire } from "module";
import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { configure } from "./plugin.js";
import { buildSessionUsage } from "./session-usage.js";

function resolveSkillsPackagePath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve("@vivantel/virage-skills/package.json");
    return dirname(pkgJsonPath);
  } catch {
    return null;
  }
}

interface SkillFrontmatter {
  name: string;
  description: string;
  when_to_use: string[];
  prerequisites: string[];
  estimated_tokens: number;
  output_format: string;
}

interface SkillMeta extends SkillFrontmatter {
  has_summary: boolean;
}

function parseFrontmatter(content: string): Partial<SkillFrontmatter> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const block = match[1];

  const get = (key: string): string =>
    block.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, "m"))?.[1]?.trim() ??
    "";

  const getList = (key: string): string[] => {
    const listMatch = block.match(
      new RegExp(`^${key}:\\s*\\n((?:\\s+-[^\\n]+\\n?)+)`, "m"),
    );
    if (!listMatch) return [];
    return listMatch[1]
      .split("\n")
      .map((l) =>
        l
          .replace(/^\s+-\s*/, "")
          .replace(/^"(.*)"$/, "$1")
          .trim(),
      )
      .filter(Boolean);
  };

  const tokensMatch = block.match(/^estimated_tokens:\s*(\d+)/m);

  return {
    name: get("name"),
    description: get("description"),
    when_to_use: getList("when_to_use"),
    prerequisites: getList("prerequisites"),
    estimated_tokens: tokensMatch ? parseInt(tokensMatch[1], 10) : 0,
    output_format: get("output_format"),
  };
}

async function listSkillsMeta(skillsRoot: string): Promise<SkillMeta[]> {
  try {
    const entries = await readdir(skillsRoot, { withFileTypes: true });
    const dirs = entries
      .filter(
        (e) =>
          e.isDirectory() && existsSync(join(skillsRoot, e.name, "SKILL.md")),
      )
      .map((e) => e.name)
      .sort();

    return await Promise.all(
      dirs.map(async (name) => {
        const skillPath = join(skillsRoot, name, "SKILL.md");
        const summaryPath = join(skillsRoot, name, "SKILL.summary.md");
        const content = await readFile(skillPath, "utf-8").catch(() => "");
        const fm = parseFrontmatter(content);
        const has_summary = existsSync(summaryPath);
        return {
          name,
          description: fm.description ?? "",
          when_to_use: fm.when_to_use ?? [],
          prerequisites: fm.prerequisites ?? [],
          estimated_tokens: fm.estimated_tokens ?? 0,
          output_format: fm.output_format ?? "",
          has_summary,
        } satisfies SkillMeta;
      }),
    );
  } catch {
    return [];
  }
}

export function createAgentMcpServer(): McpServer {
  const server = new McpServer({ name: "virage", version: "0.1.0" });

  server.tool(
    "list_skills",
    [
      "List all available Virage agent skills with structured metadata.",
      "Response shape: { schema_version: 2, names: string[], skills: SkillMeta[] }",
      "Each SkillMeta includes: name, description, when_to_use[], prerequisites[], estimated_tokens, output_format, has_summary.",
      "Use when_to_use and estimated_tokens to decide which skill to load (or skip).",
      "If has_summary is true, call read_skill_summary first for a ≤20-line overview before committing to read_skill.",
    ].join(" "),
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
      const skills = await listSkillsMeta(join(pkgPath, "skills"));
      const result = {
        schema_version: 2,
        names: skills.map((s) => s.name),
        skills,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "read_skill_summary",
    "Read a compact summary of a Virage skill (≤20 lines, ~150 tokens). Use before read_skill to verify this skill fits your task. Falls back to the first 20 lines of SKILL.md if no summary file exists.",
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
      const summaryPath = join(pkgPath, "skills", name, "SKILL.summary.md");
      if (existsSync(summaryPath)) {
        try {
          const content = await readFile(summaryPath, "utf-8");
          return { content: [{ type: "text", text: content }] };
        } catch {
          // fall through to SKILL.md fallback
        }
      }
      const skillPath = join(pkgPath, "skills", name, "SKILL.md");
      try {
        const content = await readFile(skillPath, "utf-8");
        const lines = content.split("\n").slice(0, 20).join("\n");
        return {
          content: [
            {
              type: "text",
              text: `${lines}\n\n[truncated — call read_skill('${name}') for full content]`,
            },
          ],
        };
      } catch {
        return {
          content: [{ type: "text", text: `Skill '${name}' not found.` }],
        };
      }
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
          content: [{ type: "text", text: `Skill '${name}' not found.` }],
        };
      }
    },
  );

  server.tool(
    "suggest_skill",
    "Given a one-sentence task description, return the best-matching Virage skill(s) based on keyword overlap with when_to_use metadata. Returns top-2 matches with rationale. Call this when unsure which skill to use.",
    {
      task: z
        .string()
        .describe("One-sentence description of the task you are about to do"),
    },
    async ({ task }) => {
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
      const skills = await listSkillsMeta(join(pkgPath, "skills"));
      const taskLower = task.toLowerCase();

      const scored = skills.map((skill) => {
        const haystack = [skill.name, skill.description, ...skill.when_to_use]
          .join(" ")
          .toLowerCase();

        const words = taskLower.split(/\s+/).filter((w) => w.length > 2);
        const hits = words.filter((w) => haystack.includes(w)).length;
        const nameBonus =
          taskLower.includes(skill.name.replace("-", " ")) ||
          taskLower.includes(skill.name)
            ? 2
            : 0;

        const matchingConditions = skill.when_to_use.filter((cond) => {
          const condLower = cond.toLowerCase();
          return words.some((w) => condLower.includes(w));
        });

        return {
          name: skill.name,
          description: skill.description,
          estimated_tokens: skill.estimated_tokens,
          has_summary: skill.has_summary,
          score: hits + nameBonus,
          match_reason: matchingConditions[0] ?? skill.when_to_use[0] ?? "",
        };
      });

      const top2 = scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map(({ score: _score, ...rest }) => rest);

      if (top2.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  matches: [],
                  suggestion:
                    "No close match found. Call list_skills to browse all available skills.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                matches: top2,
                tip: top2[0].has_summary
                  ? `Call read_skill_summary('${top2[0].name}') to verify fit before loading the full skill.`
                  : `Call read_skill('${top2[0].name}') to load the full workflow.`,
              },
              null,
              2,
            ),
          },
        ],
      };
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
            ? "Claude Code hooks written to .claude/skills/virage/"
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

  server.tool(
    "session_usage",
    "Parse the current Claude Code session log and return a per-prompt token usage breakdown.",
    {},
    async () => {
      const text = await buildSessionUsage(
        process.env["CLAUDE_CODE_SESSION_ID"] ?? "",
        process.env["CLAUDE_CONFIG_DIR"] ?? "",
        process.env["PWD"] ?? "",
      );
      return { content: [{ type: "text", text }] };
    },
  );

  return server;
}

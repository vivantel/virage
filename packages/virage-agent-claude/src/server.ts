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
      .filter(
        (e) =>
          e.isDirectory() && existsSync(join(skillsRoot, e.name, "SKILL.md")),
      )
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export function createAgentMcpServer(): McpServer {
  const server = new McpServer({ name: "virage", version: "0.1.0" });

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
          content: [{ type: "text", text: `Skill '${name}' not found.` }],
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

  server.tool(
    "session_usage",
    "Parse the current Claude Code session log and return a per-prompt token usage breakdown.",
    {},
    async () => {
      const sessionId = process.env["CLAUDE_CODE_SESSION_ID"] ?? "";
      const configDir = process.env["CLAUDE_CONFIG_DIR"] ?? "";
      const pwd = process.env["PWD"] ?? "";

      if (!sessionId || !configDir || !pwd) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Missing CLAUDE_CODE_SESSION_ID, CLAUDE_CONFIG_DIR, or PWD",
            },
          ],
        };
      }

      const slug = pwd.replace(/\//g, "-");
      const logPath = join(configDir, "projects", slug, `${sessionId}.jsonl`);

      let raw: string;
      try {
        raw = await readFile(logPath, "utf-8");
      } catch {
        return {
          content: [
            { type: "text", text: `Session log not found: ${logPath}` },
          ],
        };
      }

      interface Msg {
        content?: string | Array<{ type: string; text?: string }>;
      }
      interface AsstEntry {
        type: "assistant";
        timestamp: string;
        requestId?: string;
        message: {
          usage?: {
            input_tokens: number;
            output_tokens: number;
            cache_read_input_tokens: number;
            cache_creation_input_tokens: number;
          };
        };
      }
      interface UserEntry {
        type: "user";
        timestamp?: string;
        isMeta?: boolean;
        message: Msg;
      }
      type Entry = AsstEntry | UserEntry | Record<string, unknown>;

      const entries: Entry[] = raw
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Entry);

      function isToolResult(c: unknown): boolean {
        return (
          Array.isArray(c) &&
          c.length > 0 &&
          c.every(
            (b) =>
              typeof b === "object" &&
              b !== null &&
              (b as { type: string }).type === "tool_result",
          )
        );
      }

      function toText(c: unknown): string {
        if (typeof c === "string") return c.replace(/<[^>]+>/g, " ").trim();
        if (Array.isArray(c))
          return c
            .filter((b) => (b as { type: string }).type === "text")
            .map((b) => (b as { text?: string }).text ?? "")
            .join(" ")
            .trim();
        return "";
      }

      const starters = entries.filter(
        (e): e is UserEntry =>
          (e as UserEntry).type === "user" &&
          !(e as UserEntry).isMeta &&
          !!(e as UserEntry).timestamp &&
          !isToolResult((e as UserEntry).message?.content),
      );

      const seen = new Set<string>();
      const asst = entries.filter((e): e is AsstEntry => {
        const a = e as AsstEntry;
        if (a.type !== "assistant" || !a.message?.usage || !a.timestamp)
          return false;
        if (a.requestId) {
          if (seen.has(a.requestId)) return false;
          seen.add(a.requestId);
        }
        return true;
      });

      const sTs = starters.map((e) => ({ t: new Date(e.timestamp!), e }));
      const aTs = asst.map((e) => ({ t: new Date(e.timestamp), e }));

      const W = 116;
      const lines: string[] = [];
      lines.push(`Session: ${sessionId}`);
      lines.push(`Log:     ${logPath}`);
      lines.push("");
      lines.push(
        `${"#".padStart(4)} ${"Time".padEnd(10)} ${"Prompt".padEnd(52)} ${"Input".padStart(8)} ${"CacheRd".padStart(8)} ${"CacheCr".padStart(9)} ${"Output".padStart(7)} ${"Total".padStart(9)}`,
      );
      lines.push("-".repeat(W));

      let gIn = 0,
        gCr = 0,
        gCc = 0,
        gOut = 0;

      for (let i = 0; i < sTs.length; i++) {
        const { t: ut, e: ue } = sTs[i]!;
        const nxt = sTs[i + 1]?.t;
        const win = aTs
          .filter(({ t }) => t >= ut && (!nxt || t < nxt))
          .map(({ e }) => e);
        const txt = toText(ue.message?.content);
        const lbl = txt.length > 52 ? txt.slice(0, 50) + ".." : txt;
        const u = { i: 0, cr: 0, cc: 0, o: 0 };
        for (const ae of win) {
          const us = ae.message.usage!;
          u.i += us.input_tokens;
          u.cr += us.cache_read_input_tokens;
          u.cc += us.cache_creation_input_tokens;
          u.o += us.output_tokens;
        }
        const tot = u.i + u.cr + u.cc + u.o;
        gIn += u.i;
        gCr += u.cr;
        gCc += u.cc;
        gOut += u.o;
        const ts = ut.toISOString().slice(11, 19);
        lines.push(
          `${String(i + 1).padStart(4)} ${ts.padEnd(10)} ${lbl.padEnd(52)} ${u.i.toLocaleString().padStart(8)} ${u.cr.toLocaleString().padStart(8)} ${u.cc.toLocaleString().padStart(9)} ${u.o.toLocaleString().padStart(7)} ${tot.toLocaleString().padStart(9)}`,
        );
      }

      lines.push("-".repeat(W));
      const gTot = gIn + gCr + gCc + gOut;
      lines.push(
        `${"TOTALS".padEnd(66)} ${gIn.toLocaleString().padStart(8)} ${gCr.toLocaleString().padStart(8)} ${gCc.toLocaleString().padStart(9)} ${gOut.toLocaleString().padStart(7)} ${gTot.toLocaleString().padStart(9)}`,
      );
      lines.push("");
      lines.push(
        "Legend: Input = new input tokens | CacheRd = prompt cache read | CacheCr = prompt cache write | Output = generated tokens",
      );

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  return server;
}

import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, stat, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ClaudeAgentPlugin } from "./plugin.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "virage-claude-test-"));
}

describe("ClaudeAgentPlugin — vendor surface", () => {
  const plugin = new ClaudeAgentPlugin();

  it("has correct name and label", () => {
    expect(plugin.name).toBe("claude-code");
    expect(plugin.label).toBe("Claude Code");
  });

  it("vendor is claude", () => {
    expect(plugin.vendor).toBe("claude");
  });

  it("supports pre_tool_use", () => {
    expect(plugin.supportsEvent("pre_tool_use")).toBe(true);
  });

  it("supports instructions_loaded (claude-only)", () => {
    expect(plugin.supportsEvent("instructions_loaded")).toBe(true);
  });

  it("does not support pre_invocation (antigravity-only)", () => {
    expect(plugin.supportsEvent("pre_invocation")).toBe(false);
  });

  it("does not support error_occurred (copilot-only)", () => {
    expect(plugin.supportsEvent("error_occurred")).toBe(false);
  });

  it("maps pre_tool_use to PreToolUse", () => {
    expect(plugin.getVendorEventName("pre_tool_use")).toBe("PreToolUse");
    expect(plugin.getPrimaryEventName("pre_tool_use")).toBe("PreToolUse");
  });

  it("maps agent_stop to Stop", () => {
    expect(plugin.getPrimaryEventName("agent_stop")).toBe("Stop");
  });

  it("maps pre_invocation to null", () => {
    expect(plugin.getPrimaryEventName("pre_invocation")).toBeNull();
  });

  it("hookTypes includes mcp_tool and http", () => {
    expect(plugin.vendorConfig.hookTypes).toContain("mcp_tool");
    expect(plugin.vendorConfig.hookTypes).toContain("http");
  });

  it("configLocations is non-empty", () => {
    expect(plugin.vendorConfig.configLocations.length).toBeGreaterThan(0);
  });
});

describe("ClaudeAgentPlugin — configure() file output", () => {
  it("configure() returns an AgentConfigResult (no crash)", async () => {
    const dir = await makeTempDir();
    const plugin = new ClaudeAgentPlugin();
    const result = await plugin.configure(dir);
    expect(result).toHaveProperty("hooksWritten");
    expect(typeof result.hooksWritten).toBe("boolean");
  });

  it("writes .claude/skills/virage/commands/plan.md", async () => {
    const dir = await makeTempDir();
    const plugin = new ClaudeAgentPlugin();
    await plugin.configure(dir);
    const planPath = join(
      dir,
      ".claude",
      "skills",
      "virage",
      "commands",
      "plan.md",
    );
    const s = await stat(planPath);
    expect(s.isFile()).toBe(true);
    const content = await readFile(planPath, "utf-8");
    expect(content).toContain("virage");
  });

  it("writes .claude/skills/virage/commands/usage.md", async () => {
    const dir = await makeTempDir();
    const plugin = new ClaudeAgentPlugin();
    await plugin.configure(dir);
    const usagePath = join(
      dir,
      ".claude",
      "skills",
      "virage",
      "commands",
      "usage.md",
    );
    const s = await stat(usagePath);
    expect(s.isFile()).toBe(true);
    const content = await readFile(usagePath, "utf-8");
    expect(content).toContain("session_usage");
  });

  it("second configure() does not rewrite unchanged commands (hooksWritten: false)", async () => {
    const dir = await makeTempDir();
    const plugin = new ClaudeAgentPlugin();
    await plugin.configure(dir);
    const result2 = await plugin.configure(dir);
    expect(result2.hooksWritten).toBe(false);
  });

  it("copies plugin-level .mcp.json into .claude/skills/virage/", async () => {
    const dir = await makeTempDir();
    const plugin = new ClaudeAgentPlugin();
    await plugin.configure(dir);
    const pluginMcpPath = join(dir, ".claude", "skills", "virage", ".mcp.json");
    const s = await stat(pluginMcpPath);
    expect(s.isFile()).toBe(true);
    const cfg = JSON.parse(await readFile(pluginMcpPath, "utf-8")) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(cfg.mcpServers).toHaveProperty("virage");
  });

  it("registers MCP server in .mcp.json", async () => {
    const dir = await makeTempDir();
    const plugin = new ClaudeAgentPlugin();
    const result = await plugin.configure(dir);
    expect(result.mcpRegistered).toBe(true);
    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8")) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(mcp.mcpServers).toHaveProperty("virage");
  });

  it("second configure() call does not re-register MCP server", async () => {
    const dir = await makeTempDir();
    const plugin = new ClaudeAgentPlugin();
    await plugin.configure(dir);
    const result2 = await plugin.configure(dir);
    expect(result2.mcpRegistered).toBe(false);
  });
});

describe("ClaudeAgentPlugin — mergeHooks() idempotency", () => {
  it("writes [Virage] hooks on first configure()", async () => {
    const dir = await makeTempDir();
    const plugin = new ClaudeAgentPlugin();
    await plugin.configure(dir);
    const raw = await readFile(join(dir, ".claude", "settings.json"), "utf-8");
    expect(raw).toContain("[Virage]");
  });

  it("second configure() produces identical settings.json (truly idempotent)", async () => {
    const dir = await makeTempDir();
    const plugin = new ClaudeAgentPlugin();
    await plugin.configure(dir);
    const after1 = await readFile(
      join(dir, ".claude", "settings.json"),
      "utf-8",
    );
    await plugin.configure(dir);
    const after2 = await readFile(
      join(dir, ".claude", "settings.json"),
      "utf-8",
    );
    expect(after2).toBe(after1);
  });

  it("replaces stale [Virage] hook command on re-configure", async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, ".claude"), { recursive: true });
    const stale = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command", command: "echo '[Virage] old stale hook'" },
            ],
          },
        ],
      },
    };
    await writeFile(
      join(dir, ".claude", "settings.json"),
      JSON.stringify(stale, null, 2),
    );

    const plugin = new ClaudeAgentPlugin();
    await plugin.configure(dir);

    const raw = await readFile(join(dir, ".claude", "settings.json"), "utf-8");
    expect(raw).not.toContain("old stale hook");
    expect(raw).toContain("[Virage]");
  });

  it("removes a [Virage] hook for an event no longer in VIRAGE_HOOKS", async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, ".claude"), { recursive: true });
    const withExtra = {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "echo '[Virage] removed event hook'",
              },
            ],
          },
        ],
      },
    };
    await writeFile(
      join(dir, ".claude", "settings.json"),
      JSON.stringify(withExtra, null, 2),
    );

    const plugin = new ClaudeAgentPlugin();
    await plugin.configure(dir);

    const raw = await readFile(join(dir, ".claude", "settings.json"), "utf-8");
    expect(raw).not.toContain("removed event hook");
  });

  it("preserves non-Virage hooks alongside Virage hooks", async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, ".claude"), { recursive: true });
    const existing = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash(*git commit*)",
            hooks: [{ type: "command", command: "npm run lint" }],
          },
        ],
      },
    };
    await writeFile(
      join(dir, ".claude", "settings.json"),
      JSON.stringify(existing, null, 2),
    );

    const plugin = new ClaudeAgentPlugin();
    await plugin.configure(dir);

    const raw = await readFile(join(dir, ".claude", "settings.json"), "utf-8");
    expect(raw).toContain("npm run lint");
    expect(raw).toContain("[Virage]");
  });
});

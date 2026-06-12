import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, stat } from "fs/promises";
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

  it("writes .claude/skills/virage-agent/commands/virage-plan.md", async () => {
    const dir = await makeTempDir();
    const plugin = new ClaudeAgentPlugin();
    await plugin.configure(dir);
    const planPath = join(
      dir,
      ".claude",
      "skills",
      "virage-agent",
      "commands",
      "virage-plan.md",
    );
    const s = await stat(planPath);
    expect(s.isFile()).toBe(true);
    const content = await readFile(planPath, "utf-8");
    expect(content).toContain("virage");
  });

  it("second configure() does not rewrite unchanged commands (hooksWritten: false)", async () => {
    const dir = await makeTempDir();
    const plugin = new ClaudeAgentPlugin();
    await plugin.configure(dir);
    const result2 = await plugin.configure(dir);
    expect(result2.hooksWritten).toBe(false);
  });

  it("registers MCP server in .mcp.json", async () => {
    const dir = await makeTempDir();
    const plugin = new ClaudeAgentPlugin();
    const result = await plugin.configure(dir);
    expect(result.mcpRegistered).toBe(true);
    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8")) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(mcp.mcpServers).toHaveProperty("virage-agent");
  });

  it("second configure() call does not re-register MCP server", async () => {
    const dir = await makeTempDir();
    const plugin = new ClaudeAgentPlugin();
    await plugin.configure(dir);
    const result2 = await plugin.configure(dir);
    expect(result2.mcpRegistered).toBe(false);
  });
});

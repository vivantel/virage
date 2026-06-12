import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { CopilotAgentPlugin } from "./plugin.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "virage-copilot-test-"));
}

describe("CopilotAgentPlugin — vendor surface", () => {
  const plugin = new CopilotAgentPlugin();

  it("has correct name and label", () => {
    expect(plugin.name).toBe("copilot");
    expect(plugin.label).toBe("GitHub Copilot");
  });

  it("vendor is copilot", () => {
    expect(plugin.vendor).toBe("copilot");
  });

  it("supports pre_tool_use", () => {
    expect(plugin.supportsEvent("pre_tool_use")).toBe(true);
  });

  it("supports error_occurred (copilot-specific)", () => {
    expect(plugin.supportsEvent("error_occurred")).toBe(true);
  });

  it("does not support instructions_loaded (claude-only)", () => {
    expect(plugin.supportsEvent("instructions_loaded")).toBe(false);
  });

  it("does not support pre_invocation (antigravity-only)", () => {
    expect(plugin.supportsEvent("pre_invocation")).toBe(false);
  });

  it("maps pre_tool_use to dual-name array with camelCase first", () => {
    expect(plugin.getVendorEventName("pre_tool_use")).toEqual([
      "preToolUse",
      "PreToolUse",
    ]);
    expect(plugin.getPrimaryEventName("pre_tool_use")).toBe("preToolUse");
  });

  it("maps agent_stop to [agentStop, Stop]", () => {
    expect(plugin.getPrimaryEventName("agent_stop")).toBe("agentStop");
  });

  it("getPrimaryEventName returns null for unsupported events", () => {
    expect(plugin.getPrimaryEventName("instructions_loaded")).toBeNull();
    expect(plugin.getPrimaryEventName("pre_invocation")).toBeNull();
  });

  it("hookTypes does not include mcp_tool", () => {
    expect(plugin.vendorConfig.hookTypes).not.toContain("mcp_tool");
  });

  it("configLocations is non-empty", () => {
    expect(plugin.vendorConfig.configLocations.length).toBeGreaterThan(0);
  });
});

describe("CopilotAgentPlugin — configure() file output", () => {
  it("configure() returns an object with hooksWritten boolean (no crash)", async () => {
    const dir = await makeTempDir();
    const plugin = new CopilotAgentPlugin();
    const result = await plugin.configure(dir);
    expect(result).toHaveProperty("hooksWritten");
    expect(typeof result.hooksWritten).toBe("boolean");
  });

  it("writes .github/copilot/hooks.json with valid JSON structure", async () => {
    const dir = await makeTempDir();
    const plugin = new CopilotAgentPlugin();
    await plugin.configure(dir);

    const hooksPath = join(dir, ".github", "copilot", "hooks.json");
    const raw = await readFile(hooksPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      version: string;
      hooks: { PreToolUse: unknown[]; PostToolUse: unknown[] };
    };
    expect(parsed).toHaveProperty("version");
    expect(parsed).toHaveProperty("hooks");
    expect(Array.isArray(parsed.hooks.PreToolUse)).toBe(true);
    expect(Array.isArray(parsed.hooks.PostToolUse)).toBe(true);
  });

  it("second configure() call does not grow hook arrays (idempotent)", async () => {
    const dir = await makeTempDir();
    const plugin = new CopilotAgentPlugin();
    await plugin.configure(dir);

    const hooksPath = join(dir, ".github", "copilot", "hooks.json");
    const after1 = JSON.parse(await readFile(hooksPath, "utf-8")) as {
      hooks: { PreToolUse: unknown[] };
    };
    const countAfter1 = after1.hooks.PreToolUse.length;

    const result2 = await plugin.configure(dir);
    expect(result2.hooksWritten).toBe(false);

    const after2 = JSON.parse(await readFile(hooksPath, "utf-8")) as {
      hooks: { PreToolUse: unknown[] };
    };
    expect(after2.hooks.PreToolUse).toHaveLength(countAfter1);
  });

  it("works when target directory does not exist yet", async () => {
    const base = await makeTempDir();
    const dir = join(base, "nested", "project");
    const plugin = new CopilotAgentPlugin();
    await expect(plugin.configure(dir)).resolves.toHaveProperty("hooksWritten");
  });
});

import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { AntigravityAgentPlugin } from "./plugin.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "virage-antigravity-test-"));
}

describe("AntigravityAgentPlugin — vendor surface", () => {
  const plugin = new AntigravityAgentPlugin();

  it("has correct name and label", () => {
    expect(plugin.name).toBe("antigravity");
    expect(plugin.label).toBe("Google Antigravity");
  });

  it("vendor is antigravity", () => {
    expect(plugin.vendor).toBe("antigravity");
  });

  it("supports pre_tool_use and post_tool_use", () => {
    expect(plugin.supportsEvent("pre_tool_use")).toBe(true);
    expect(plugin.supportsEvent("post_tool_use")).toBe(true);
  });

  it("supports pre_invocation and post_invocation (antigravity-specific)", () => {
    expect(plugin.supportsEvent("pre_invocation")).toBe(true);
    expect(plugin.supportsEvent("post_invocation")).toBe(true);
  });

  it("does not support session_start", () => {
    expect(plugin.supportsEvent("session_start")).toBe(false);
  });

  it("does not support instructions_loaded (claude-only)", () => {
    expect(plugin.supportsEvent("instructions_loaded")).toBe(false);
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

  it("maps pre_invocation to PreInvocation", () => {
    expect(plugin.getPrimaryEventName("pre_invocation")).toBe("PreInvocation");
  });

  it("maps post_invocation to PostInvocation", () => {
    expect(plugin.getPrimaryEventName("post_invocation")).toBe(
      "PostInvocation",
    );
  });

  it("getPrimaryEventName returns null for unsupported events", () => {
    expect(plugin.getPrimaryEventName("session_start")).toBeNull();
    expect(plugin.getPrimaryEventName("instructions_loaded")).toBeNull();
  });

  it("supports only command hook type", () => {
    expect(plugin.vendorConfig.hookTypes).toEqual(["command"]);
  });

  it("configLocations is non-empty", () => {
    expect(plugin.vendorConfig.configLocations.length).toBeGreaterThan(0);
  });
});

describe("AntigravityAgentPlugin — configure() file output", () => {
  it("configure() returns an object with hooksWritten boolean (no crash)", async () => {
    const dir = await makeTempDir();
    const plugin = new AntigravityAgentPlugin();
    const result = await plugin.configure(dir);
    expect(result).toHaveProperty("hooksWritten");
    expect(typeof result.hooksWritten).toBe("boolean");
  });

  it("writes .antigravity/hooks.json with valid JSON structure", async () => {
    const dir = await makeTempDir();
    const plugin = new AntigravityAgentPlugin();
    await plugin.configure(dir);

    const hooksPath = join(dir, ".antigravity", "hooks.json");
    const raw = await readFile(hooksPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      hooks: { PreToolUse: unknown[]; PostToolUse: unknown[] };
    };
    expect(parsed).toHaveProperty("hooks");
    expect(Array.isArray(parsed.hooks.PreToolUse)).toBe(true);
    expect(Array.isArray(parsed.hooks.PostToolUse)).toBe(true);
  });

  it("adds terminationBehavior: continue to each hook entry", async () => {
    const dir = await makeTempDir();
    const plugin = new AntigravityAgentPlugin();
    await plugin.configure(dir);

    const raw = await readFile(
      join(dir, ".antigravity", "hooks.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as {
      hooks: { PreToolUse: { terminationBehavior?: string }[] };
    };
    for (const hook of parsed.hooks.PreToolUse) {
      expect(hook.terminationBehavior).toBe("continue");
    }
  });

  it("does not duplicate hooks on second configure() call", async () => {
    const dir = await makeTempDir();
    const plugin = new AntigravityAgentPlugin();
    await plugin.configure(dir);

    const hooksPath = join(dir, ".antigravity", "hooks.json");
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
    const plugin = new AntigravityAgentPlugin();
    await expect(plugin.configure(dir)).resolves.toHaveProperty("hooksWritten");
  });
});

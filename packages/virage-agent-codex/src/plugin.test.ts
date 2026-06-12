import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { CodexAgentPlugin } from "./plugin.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "virage-codex-test-"));
}

describe("CodexAgentPlugin — vendor surface", () => {
  const plugin = new CodexAgentPlugin();

  it("has correct name and label", () => {
    expect(plugin.name).toBe("codex");
    expect(plugin.label).toBe("OpenAI Codex");
  });

  it("vendor is codex", () => {
    expect(plugin.vendor).toBe("codex");
  });

  it("supports pre_tool_use", () => {
    expect(plugin.supportsEvent("pre_tool_use")).toBe(true);
  });

  it("supports post_compact (codex-specific)", () => {
    expect(plugin.supportsEvent("post_compact")).toBe(true);
  });

  it("does not support instructions_loaded (claude-only)", () => {
    expect(plugin.supportsEvent("instructions_loaded")).toBe(false);
  });

  it("does not support pre_invocation (antigravity-only)", () => {
    expect(plugin.supportsEvent("pre_invocation")).toBe(false);
  });

  it("does not support error_occurred (copilot-only)", () => {
    expect(plugin.supportsEvent("error_occurred")).toBe(false);
  });

  it("maps pre_tool_use to PreToolUse (PascalCase)", () => {
    expect(plugin.getVendorEventName("pre_tool_use")).toBe("PreToolUse");
    expect(plugin.getPrimaryEventName("pre_tool_use")).toBe("PreToolUse");
  });

  it("maps agent_stop to Stop", () => {
    expect(plugin.getPrimaryEventName("agent_stop")).toBe("Stop");
  });

  it("getPrimaryEventName returns null for unsupported events", () => {
    expect(plugin.getPrimaryEventName("instructions_loaded")).toBeNull();
    expect(plugin.getPrimaryEventName("pre_invocation")).toBeNull();
  });

  it("supports only command hook type", () => {
    expect(plugin.vendorConfig.hookTypes).toEqual(["command"]);
  });

  it("configLocations is non-empty", () => {
    expect(plugin.vendorConfig.configLocations.length).toBeGreaterThan(0);
  });
});

describe("CodexAgentPlugin — configure() file output", () => {
  it("configure() returns an object with hooksWritten boolean (no crash)", async () => {
    const dir = await makeTempDir();
    const plugin = new CodexAgentPlugin();
    const result = await plugin.configure(dir);
    expect(result).toHaveProperty("hooksWritten");
    expect(typeof result.hooksWritten).toBe("boolean");
  });

  it("writes .codex/hooks.json with valid JSON structure", async () => {
    const dir = await makeTempDir();
    const plugin = new CodexAgentPlugin();
    await plugin.configure(dir);

    const hooksPath = join(dir, ".codex", "hooks.json");
    const raw = await readFile(hooksPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      hooks: { PreToolUse: unknown[]; PostToolUse: unknown[] };
    };
    expect(parsed).toHaveProperty("hooks");
    expect(Array.isArray(parsed.hooks.PreToolUse)).toBe(true);
    expect(Array.isArray(parsed.hooks.PostToolUse)).toBe(true);
  });

  it("does not include version field (Codex format)", async () => {
    const dir = await makeTempDir();
    const plugin = new CodexAgentPlugin();
    await plugin.configure(dir);

    const raw = await readFile(join(dir, ".codex", "hooks.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("version");
  });

  it("second configure() call does not grow hook arrays (idempotent)", async () => {
    const dir = await makeTempDir();
    const plugin = new CodexAgentPlugin();
    await plugin.configure(dir);

    const hooksPath = join(dir, ".codex", "hooks.json");
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
    const plugin = new CodexAgentPlugin();
    await expect(plugin.configure(dir)).resolves.toHaveProperty("hooksWritten");
  });
});

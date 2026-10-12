import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ClaudeAgentPlugin } from "./plugin.js";

async function conformantDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "virage-claude-conf-"));
  await mkdir(join(dir, ".go-getter", "retrieval"), { recursive: true });
  await writeFile(join(dir, ".go-getter", "retrieval", "policy.json"), "{}");
  return dir;
}

describe("ClaudeAgentPlugin — conformance mode (retrieval contract v0)", () => {
  it("registers no MCP entry and no settings hook", async () => {
    const dir = await conformantDir();
    const result = await new ClaudeAgentPlugin().configure(dir);
    expect(result.mcpRegistered).toBeUndefined();
    await expect(stat(join(dir, ".mcp.json"))).rejects.toThrow();
    await expect(stat(join(dir, ".claude", "settings.json"))).rejects.toThrow();
  });

  it("does not copy plugin-level MCP or manifest files", async () => {
    const dir = await conformantDir();
    await new ClaudeAgentPlugin().configure(dir);
    const base = join(dir, ".claude", "skills", "virage");
    await expect(stat(join(base, ".mcp.json"))).rejects.toThrow();
    await expect(
      stat(join(base, ".claude-plugin", "plugin.json")),
    ).rejects.toThrow();
  });

  it("skips MCP-dependent commands but keeps the others", async () => {
    const dir = await conformantDir();
    await new ClaudeAgentPlugin().configure(dir);
    const commands = join(dir, ".claude", "skills", "virage", "commands");
    await expect(stat(join(commands, "rag.md"))).rejects.toThrow();
    await expect(stat(join(commands, "plan.md"))).rejects.toThrow();
    expect((await stat(join(commands, "index.md"))).isFile()).toBe(true);
    expect((await stat(join(commands, "quality.md"))).isFile()).toBe(true);
  });

  it("explicit retrieval.conformance=false restores default registration", async () => {
    const dir = await conformantDir();
    await writeFile(
      join(dir, "virage.config.json"),
      JSON.stringify({ retrieval: { conformance: false } }),
    );
    const result = await new ClaudeAgentPlugin().configure(dir);
    expect(result.mcpRegistered).toBeDefined();
    expect((await stat(join(dir, ".mcp.json"))).isFile()).toBe(true);
  });

  it("leaves a pre-existing virage entry untouched", async () => {
    const dir = await conformantDir();
    const existing = JSON.stringify({ mcpServers: { virage: { type: "x" } } });
    await writeFile(join(dir, ".mcp.json"), existing);
    await new ClaudeAgentPlugin().configure(dir);
    expect(await readFile(join(dir, ".mcp.json"), "utf-8")).toBe(existing);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  isVirageHook,
  removeHostRegistrations,
  stripMcpEntries,
  stripVirageHooks,
} from "./host-config-cleanup.js";
import { declarationPath, writeDeclaration } from "./retrieval-contract.js";

const VIRAGE_HOOK = {
  type: "command",
  command:
    'prompt=$(cat); npx --yes @vivantel/virage-agent-claude inject-context "$prompt" 2>/dev/null || true',
  statusMessage: "[Virage] Loading context...",
};

const OTHER_HOOK = { type: "command", command: "echo mine" };

describe("isVirageHook", () => {
  it("recognises the marker and the inject-context command", () => {
    expect(isVirageHook(VIRAGE_HOOK)).toBe(true);
    expect(isVirageHook({ type: "command", command: "x [Virage] y" })).toBe(
      true,
    );
    expect(
      isVirageHook({
        type: "command",
        command: "npx virage-agent-claude inject-context",
      }),
    ).toBe(true);
  });

  it("does not claim other hooks", () => {
    expect(isVirageHook(OTHER_HOOK)).toBe(false);
    expect(isVirageHook({ command: "inject-context" })).toBe(false);
    expect(isVirageHook(null)).toBe(false);
    expect(isVirageHook("string")).toBe(false);
  });
});

describe("stripMcpEntries", () => {
  it("removes only virage's entries and prunes an emptied mcpServers", () => {
    const cfg = {
      mcpServers: {
        other: { type: "stdio", command: "other" },
        virage: { type: "stdio", command: "npx" },
        "virage-agent": { type: "stdio", command: "npx" },
      },
    };
    expect(stripMcpEntries(cfg)).toEqual(["virage", "virage-agent"]);
    expect(Object.keys(cfg.mcpServers)).toEqual(["other"]);

    const only = { mcpServers: { virage: {} }, keep: 1 };
    expect(stripMcpEntries(only)).toEqual(["virage"]);
    expect(only).toEqual({ keep: 1 });
  });

  it("does nothing without a virage entry", () => {
    const cfg = { mcpServers: { other: {} } };
    expect(stripMcpEntries(cfg)).toEqual([]);
    expect(cfg).toEqual({ mcpServers: { other: {} } });
    expect(stripMcpEntries({})).toEqual([]);
  });
});

describe("stripVirageHooks", () => {
  it("removes the hook, prunes emptied matchers/events/hooks", () => {
    const s: Record<string, unknown> = {
      hooks: { UserPromptSubmit: [{ hooks: [VIRAGE_HOOK] }] },
      permissions: { allow: ["Bash(ls)"] },
    };
    expect(stripVirageHooks(s)).toBe(1);
    expect(s).toEqual({ permissions: { allow: ["Bash(ls)"] } });
  });

  it("keeps other hooks, in the same matcher and in other events", () => {
    const s: Record<string, unknown> = {
      hooks: {
        UserPromptSubmit: [
          { hooks: [OTHER_HOOK, VIRAGE_HOOK] },
          { hooks: [OTHER_HOOK] },
        ],
        PreToolUse: [{ matcher: "Bash", hooks: [OTHER_HOOK] }],
      },
    };
    expect(stripVirageHooks(s)).toBe(1);
    expect(s).toEqual({
      hooks: {
        UserPromptSubmit: [{ hooks: [OTHER_HOOK] }, { hooks: [OTHER_HOOK] }],
        PreToolUse: [{ matcher: "Bash", hooks: [OTHER_HOOK] }],
      },
    });
  });

  it("leaves unrelated and malformed shapes alone", () => {
    const s: Record<string, unknown> = {
      hooks: { Stop: "not-an-array", PreToolUse: [{ matcher: "x" }, 5] },
    };
    const before = JSON.stringify(s);
    expect(stripVirageHooks(s)).toBe(0);
    expect(JSON.stringify(s)).toBe(before);
    expect(stripVirageHooks({})).toBe(0);
  });
});

describe("removeHostRegistrations", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "virage-uninstall-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function setup(): Promise<void> {
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: { zeta: { command: "z" }, virage: { command: "npx" } },
      }),
    );
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({
        env: { A: "1" },
        hooks: { UserPromptSubmit: [{ hooks: [VIRAGE_HOOK] }] },
      }),
    );
    await writeDeclaration(dir, "1.0.0");
  }

  it("removes all three and keeps the rest of each file", async () => {
    await setup();
    const r = await removeHostRegistrations(dir);
    expect(r).toEqual({
      mcpEntries: ["virage"],
      hooks: 1,
      declaration: true,
      unreadable: [],
    });
    expect(JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"))).toEqual(
      {
        mcpServers: { zeta: { command: "z" } },
      },
    );
    expect(
      JSON.parse(
        await readFile(join(dir, ".claude", "settings.json"), "utf-8"),
      ),
    ).toEqual({ env: { A: "1" } });
    expect(existsSync(declarationPath(dir))).toBe(false);
  });

  it("dry run reports without writing", async () => {
    await setup();
    const mcpBefore = await readFile(join(dir, ".mcp.json"), "utf-8");
    const r = await removeHostRegistrations(dir, { dryRun: true });
    expect(r.mcpEntries).toEqual(["virage"]);
    expect(r.hooks).toBe(1);
    expect(r.declaration).toBe(true);
    expect(await readFile(join(dir, ".mcp.json"), "utf-8")).toBe(mcpBefore);
    expect(existsSync(declarationPath(dir))).toBe(true);
  });

  it("is idempotent and a no-op on a bare project", async () => {
    await setup();
    await removeHostRegistrations(dir);
    expect(await removeHostRegistrations(dir)).toEqual({
      mcpEntries: [],
      hooks: 0,
      declaration: false,
      unreadable: [],
    });
    const bare = await mkdtemp(join(tmpdir(), "virage-uninstall-bare-"));
    expect((await removeHostRegistrations(bare)).hooks).toBe(0);
    await rm(bare, { recursive: true, force: true });
  });

  it("leaves unparseable files untouched and reports them", async () => {
    await writeFile(join(dir, ".mcp.json"), "{ not json");
    const r = await removeHostRegistrations(dir);
    expect(r.unreadable).toEqual([".mcp.json"]);
    expect(await readFile(join(dir, ".mcp.json"), "utf-8")).toBe("{ not json");
  });

  it("does not touch another tool's declaration", async () => {
    await mkdir(join(dir, ".go-getter", "retrieval"), { recursive: true });
    const other = join(dir, ".go-getter", "retrieval", "other-tool.json");
    await writeFile(other, "{}");
    await removeHostRegistrations(dir);
    expect(existsSync(other)).toBe(true);
  });
});

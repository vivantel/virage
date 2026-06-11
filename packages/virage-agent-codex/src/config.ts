import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { AgentHooksConfig, HookEntry } from "@vivantel/virage-agent-core";

export interface CodexHooksFile {
  hooks: {
    PreToolUse: HookEntry[];
    PostToolUse: HookEntry[];
  };
}

export function translateToCodex(source: AgentHooksConfig): CodexHooksFile {
  const flattenEntries = (key: string): HookEntry[] =>
    (source.hooks[key] ?? []).flatMap((m) => m.hooks);

  return {
    hooks: {
      PreToolUse: flattenEntries("PreToolUse"),
      PostToolUse: flattenEntries("PostToolUse"),
    },
  };
}

export async function writeCodexHooks(
  config: CodexHooksFile,
  targetDir: string,
): Promise<boolean> {
  const codexDir = join(targetDir, ".codex");
  const hooksPath = join(codexDir, "hooks.json");

  let existing: CodexHooksFile = {
    hooks: { PreToolUse: [], PostToolUse: [] },
  };

  if (existsSync(hooksPath)) {
    try {
      const raw = await readFile(hooksPath, "utf-8");
      existing = JSON.parse(raw) as CodexHooksFile;
    } catch {
      process.stderr.write(
        `Warning: Could not parse ${hooksPath} — overwriting.\n`,
      );
    }
  }

  if (!existing.hooks) existing.hooks = { PreToolUse: [], PostToolUse: [] };
  if (!existing.hooks.PreToolUse) existing.hooks.PreToolUse = [];
  if (!existing.hooks.PostToolUse) existing.hooks.PostToolUse = [];

  let written = false;

  for (const event of ["PreToolUse", "PostToolUse"] as const) {
    for (const hook of config.hooks[event]) {
      const alreadyPresent = existing.hooks[event].some(
        (h) => h.command === hook.command,
      );
      if (!alreadyPresent) {
        existing.hooks[event].push(hook);
        written = true;
      }
    }
  }

  if (written) {
    await mkdir(codexDir, { recursive: true });
    await writeFile(hooksPath, JSON.stringify(existing, null, 2) + "\n");
  }

  return written;
}

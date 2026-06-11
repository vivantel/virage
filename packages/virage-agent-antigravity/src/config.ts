import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { AgentHooksConfig } from "@vivantel/virage-agent-core";

export interface AntigravityHookEntry {
  type: "command";
  command: string;
  terminationBehavior?: "continue" | "stop";
  statusMessage?: string;
}

export interface AntigravityHooksFile {
  hooks: {
    PreToolUse: AntigravityHookEntry[];
    PostToolUse: AntigravityHookEntry[];
  };
}

export function translateToAntigravity(
  source: AgentHooksConfig,
): AntigravityHooksFile {
  const flattenEntries = (key: string): AntigravityHookEntry[] =>
    (source.hooks[key] ?? []).flatMap((m) =>
      m.hooks.map((h) => ({
        type: "command" as const,
        command: h.command,
        ...(h.statusMessage ? { statusMessage: h.statusMessage } : {}),
        terminationBehavior: "continue" as const,
      })),
    );

  return {
    hooks: {
      PreToolUse: flattenEntries("PreToolUse"),
      PostToolUse: flattenEntries("PostToolUse"),
    },
  };
}

export async function writeAntigravityHooks(
  config: AntigravityHooksFile,
  targetDir: string,
): Promise<boolean> {
  const configDir = join(targetDir, ".antigravity");
  const hooksPath = join(configDir, "hooks.json");

  let existing: AntigravityHooksFile = {
    hooks: { PreToolUse: [], PostToolUse: [] },
  };

  if (existsSync(hooksPath)) {
    try {
      const raw = await readFile(hooksPath, "utf-8");
      existing = JSON.parse(raw) as AntigravityHooksFile;
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
    await mkdir(configDir, { recursive: true });
    await writeFile(hooksPath, JSON.stringify(existing, null, 2) + "\n");
  }

  return written;
}

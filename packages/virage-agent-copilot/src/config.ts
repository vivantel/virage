import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { AgentHooksConfig, HookEntry } from "@vivantel/virage-agent-core";

export interface CopilotHooksFile {
  version: string;
  hooks: {
    PreToolUse: HookEntry[];
    PostToolUse: HookEntry[];
  };
}

export function translateToCopilot(source: AgentHooksConfig): CopilotHooksFile {
  const flattenEntries = (key: string): HookEntry[] =>
    (source.hooks[key] ?? []).flatMap((m) => m.hooks);

  return {
    version: source.version,
    hooks: {
      PreToolUse: flattenEntries("PreToolUse"),
      PostToolUse: flattenEntries("PostToolUse"),
    },
  };
}

export async function writeCopilotHooks(
  config: CopilotHooksFile,
  targetDir: string,
): Promise<boolean> {
  const hooksDir = join(targetDir, ".github", "copilot");
  const hooksPath = join(hooksDir, "hooks.json");

  let existing: CopilotHooksFile = {
    version: config.version,
    hooks: { PreToolUse: [], PostToolUse: [] },
  };

  if (existsSync(hooksPath)) {
    try {
      const raw = await readFile(hooksPath, "utf-8");
      existing = JSON.parse(raw) as CopilotHooksFile;
    } catch {
      process.stderr.write(
        `Warning: Could not parse ${hooksPath} — overwriting.\n`,
      );
    }
  }

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
    await mkdir(hooksDir, { recursive: true });
    await writeFile(hooksPath, JSON.stringify(existing, null, 2) + "\n");
  }

  return written;
}

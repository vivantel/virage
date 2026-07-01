import { createOut } from "../output.js";
import { detectActiveAgent } from "./agent-context.js";

export async function runUsage(): Promise<void> {
  const out = createOut(0);
  const activePackage = detectActiveAgent();

  if (!activePackage) {
    out.error(
      "No agent context detected. Run this command inside a supported AI agent session (Claude Code, Copilot, Codex).",
    );
    process.exit(1);
  }

  // Dynamic import — agent packages are optional runtime plugins, not build-time deps.
  let mod: { buildSessionUsage?: (...args: unknown[]) => Promise<string> };
  try {
    mod = (await import(activePackage)) as typeof mod;
  } catch {
    out.error(
      `Agent plugin "${activePackage}" is not installed. Run: npm install ${activePackage}`,
    );
    process.exit(1);
  }

  if (typeof mod.buildSessionUsage !== "function") {
    out.error(
      `Agent plugin "${activePackage}" does not support the usage command.`,
    );
    process.exit(1);
  }

  const sessionId = process.env["CLAUDE_CODE_SESSION_ID"] ?? "";
  const configDir = process.env["CLAUDE_CONFIG_DIR"] ?? "";
  const pwd = process.env["PWD"] ?? "";
  if (!sessionId || !configDir || !pwd) {
    out.error(
      "CLAUDE_CODE_SESSION_ID, CLAUDE_CONFIG_DIR, or PWD not set. Run this command inside a Claude Code session.",
    );
    process.exit(1);
  }

  out.info(await mod.buildSessionUsage(sessionId, configDir, pwd));
}

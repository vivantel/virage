import { buildSessionUsage } from "@vivantel/virage-agent-claude";
import { createOut } from "../output.js";

export async function runUsage(): Promise<void> {
  const out = createOut(0);
  const sessionId = process.env["CLAUDE_CODE_SESSION_ID"] ?? "";
  const configDir = process.env["CLAUDE_CONFIG_DIR"] ?? "";
  const pwd = process.env["PWD"] ?? "";
  if (!sessionId || !configDir || !pwd) {
    out.error(
      "CLAUDE_CODE_SESSION_ID, CLAUDE_CONFIG_DIR, or PWD not set. Run this command inside a Claude Code session.",
    );
    process.exit(1);
  }
  out.info(await buildSessionUsage(sessionId, configDir, pwd));
}

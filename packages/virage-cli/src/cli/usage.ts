import { buildSessionUsage } from "@vivantel/virage-agent-claude";

export async function runUsage(): Promise<void> {
  const sessionId = process.env["CLAUDE_CODE_SESSION_ID"] ?? "";
  const configDir = process.env["CLAUDE_CONFIG_DIR"] ?? "";
  const pwd = process.env["PWD"] ?? "";
  if (!sessionId || !configDir || !pwd) {
    console.error(
      "Error: CLAUDE_CODE_SESSION_ID, CLAUDE_CONFIG_DIR, or PWD not set.\n" +
        "Run this command inside a Claude Code session.",
    );
    process.exit(1);
  }
  console.log(await buildSessionUsage(sessionId, configDir, pwd));
}

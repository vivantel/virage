/**
 * Detects which AI agent environment the CLI is currently running inside.
 * Returns the npm package name of the active agent plugin, or null if none.
 *
 * Detection order (highest priority first):
 *   1. CLAUDE_CODE_SESSION_ID  → virage-agent-claude
 *   2. GITHUB_COPILOT_*        → virage-agent-copilot
 *   3. OPENAI_CODEX_*          → virage-agent-codex
 *   4. Fallback: first entry in config.agents
 */
export function detectActiveAgent(
  configAgents?: Array<{ package: string }>,
): string | null {
  if (process.env["CLAUDE_CODE_SESSION_ID"]) {
    return "@vivantel/virage-agent-claude";
  }
  if (Object.keys(process.env).some((k) => k.startsWith("GITHUB_COPILOT_"))) {
    return "@vivantel/virage-agent-copilot";
  }
  if (
    Object.keys(process.env).some(
      (k) => k.startsWith("OPENAI_CODEX_") || k.startsWith("OPENAI_API_CODEX_"),
    )
  ) {
    return "@vivantel/virage-agent-codex";
  }
  return configAgents?.[0]?.package ?? null;
}

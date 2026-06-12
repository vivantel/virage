import {
  BaseAgentPlugin,
  CODEX_VENDOR_CONFIG,
} from "@vivantel/virage-agent-core";
import type { AgentConfigResult } from "@vivantel/virage-agent-core";

export class CodexAgentPlugin extends BaseAgentPlugin {
  readonly name = "codex";
  readonly label = "OpenAI Codex";
  readonly vendorConfig = CODEX_VENDOR_CONFIG;
}

export type { AgentConfigResult };

const plugin = new CodexAgentPlugin();
export const configure = plugin.configure.bind(plugin);

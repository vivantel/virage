import {
  BaseAgentPlugin,
  COPILOT_VENDOR_CONFIG,
} from "@vivantel/virage-agent-core";
import type { AgentConfigResult } from "@vivantel/virage-agent-core";

export class CopilotAgentPlugin extends BaseAgentPlugin {
  readonly name = "copilot";
  readonly label = "GitHub Copilot";
  readonly vendorConfig = COPILOT_VENDOR_CONFIG;
}

export type { AgentConfigResult };

const plugin = new CopilotAgentPlugin();
export const configure = plugin.configure.bind(plugin);

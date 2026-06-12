import {
  BaseAgentPlugin,
  ANTIGRAVITY_VENDOR_CONFIG,
} from "@vivantel/virage-agent-core";
import type { AgentConfigResult } from "@vivantel/virage-agent-core";

export class AntigravityAgentPlugin extends BaseAgentPlugin {
  readonly name = "antigravity";
  readonly label = "Google Antigravity";
  readonly vendorConfig = ANTIGRAVITY_VENDOR_CONFIG;
}

export type { AgentConfigResult };

const plugin = new AntigravityAgentPlugin();
export const configure = plugin.configure.bind(plugin);

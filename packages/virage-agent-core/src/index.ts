export { NORMALIZED_EVENTS } from "./types/events.js";
export type { NormalizedEventName } from "./types/events.js";

export type { VendorName, HookType, VendorConfig } from "./types/vendor.js";

export type {
  PermissionMode,
  AgentHookInput,
  AgentHookOutput,
} from "./types/io.js";
export type {
  PreToolUseDecision,
  PreToolUseInput,
  PreToolUseOutput,
  PostToolUseInput,
  PostToolUseOutput,
  AgentStopDecision,
  AgentStopInput,
  AgentStopOutput,
  UserPromptSubmitInput,
  UserPromptSubmitOutput,
} from "./types/io.js";

export type {
  CommandHookEntry,
  HookEntry,
  HookMatcher,
  AgentHooksConfig,
} from "./types/hook-config.js";

export type { AgentConfigResult } from "./types/result.js";

export { BaseAgentPlugin } from "./base/base-agent.js";

export {
  CLAUDE_VENDOR_CONFIG,
  COPILOT_VENDOR_CONFIG,
  CODEX_VENDOR_CONFIG,
  ANTIGRAVITY_VENDOR_CONFIG,
} from "./constants/vendor-configs.js";

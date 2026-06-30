export type PermissionMode =
  "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";

// ── Common base ───────────────────────────────────────────────────────────────

export interface AgentHookInput {
  session_id: string;
  transcript_path?: string | null;
  cwd: string;
  hook_event_name: string;
  permission_mode?: PermissionMode;
  [key: string]: unknown;
}

export interface AgentHookOutput {
  continue?: boolean;
  stopReason?: string;
  systemMessage?: string;
  suppressOutput?: boolean;
  additionalContext?: string;
}

// ── PreToolUse ────────────────────────────────────────────────────────────────

export type PreToolUseDecision = "allow" | "deny" | "ask" | "defer";

export interface PreToolUseInput extends AgentHookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface PreToolUseOutput extends AgentHookOutput {
  permissionDecision?: PreToolUseDecision;
  updatedInput?: Record<string, unknown>;
}

// ── PostToolUse ───────────────────────────────────────────────────────────────

export interface PostToolUseInput extends AgentHookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: unknown;
}

export type PostToolUseOutput = AgentHookOutput;

// ── AgentStop ─────────────────────────────────────────────────────────────────

export type AgentStopDecision = "block" | "continue";

export interface AgentStopInput extends AgentHookInput {
  stop_reason?: string;
}

export interface AgentStopOutput extends AgentHookOutput {
  decision?: AgentStopDecision;
}

// ── UserPromptSubmit ──────────────────────────────────────────────────────────

export interface UserPromptSubmitInput extends AgentHookInput {
  prompt: string;
}

export type UserPromptSubmitOutput = AgentHookOutput;

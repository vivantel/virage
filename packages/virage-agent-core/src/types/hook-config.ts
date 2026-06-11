export interface CommandHookEntry {
  type: "command";
  command: string;
  statusMessage?: string;
}

export type HookEntry = CommandHookEntry;

export interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
}

export interface AgentHooksConfig {
  version: string;
  hooks: Record<string, HookMatcher[]>;
}

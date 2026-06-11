import type { NormalizedEventName } from "./events.js";

export type VendorName =
  | "claude"
  | "copilot"
  | "codex"
  | "cursor"
  | "antigravity";

export type HookType = "command" | "http" | "mcp_tool" | "prompt" | "agent";

export interface VendorConfig {
  readonly vendor: VendorName;
  readonly supportedEvents: ReadonlyArray<NormalizedEventName>;
  readonly hookTypes: ReadonlyArray<HookType>;
  readonly configLocations: ReadonlyArray<string>;
  readonly eventNameMap: Readonly<
    Partial<Record<NormalizedEventName, string | string[] | null>>
  >;
}

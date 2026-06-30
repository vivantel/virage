import type { NormalizedEventName } from "./events.js";

export type VendorName =
  "claude" | "copilot" | "codex" | "cursor" | "antigravity";

export type HookType = "command" | "http" | "mcp_tool" | "prompt" | "agent";

export interface VendorConfig {
  readonly vendor: VendorName;
  readonly supportedEvents: ReadonlyArray<NormalizedEventName>;
  readonly hookTypes: ReadonlyArray<HookType>;
  readonly configLocations: ReadonlyArray<string>;
  readonly eventNameMap: Readonly<
    Partial<Record<NormalizedEventName, string | string[] | null>>
  >;
  /** npm package name for this plugin (used to resolve plugin-config/ at runtime). */
  readonly packageName: string;
  /** Subdirectory within the plugin package containing static config files to copy. */
  readonly pluginConfigDir: string;
  /** Project-relative directory where plugin config files are placed during configure(). */
  readonly projectConfigDir: string;
}

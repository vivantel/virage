import { createRequire } from "module";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import {
  BaseAgentPlugin,
  COPILOT_VENDOR_CONFIG,
} from "@vivantel/virage-agent-core";
import type {
  AgentConfigResult,
  AgentHooksConfig,
} from "@vivantel/virage-agent-core";
import { translateToCopilot, writeCopilotHooks } from "./config.js";

export class CopilotAgentPlugin extends BaseAgentPlugin {
  readonly name = "copilot";
  readonly label = "GitHub Copilot";
  readonly vendorConfig = COPILOT_VENDOR_CONFIG;

  async configure(
    targetDir: string = process.cwd(),
  ): Promise<AgentConfigResult> {
    const hooksConfig = await this.readHooksConfig();
    if (!hooksConfig) return { hooksWritten: false };

    const copilotConfig = translateToCopilot(hooksConfig);
    const hooksWritten = await writeCopilotHooks(copilotConfig, targetDir);

    return { hooksWritten };
  }

  private resolveSkillsPackagePath(): string | null {
    try {
      const require = createRequire(import.meta.url);
      const pkgJsonPath =
        require.resolve("@vivantel/virage-skills/package.json");
      return dirname(pkgJsonPath);
    } catch {
      return null;
    }
  }

  private async readHooksConfig(): Promise<AgentHooksConfig | null> {
    const skillsPkgPath = this.resolveSkillsPackagePath();
    if (!skillsPkgPath) return null;
    try {
      const raw = await readFile(
        join(skillsPkgPath, "agent-config", "hooks.json"),
        "utf-8",
      );
      return JSON.parse(raw) as AgentHooksConfig;
    } catch {
      return null;
    }
  }
}

const plugin = new CopilotAgentPlugin();
export const configure = plugin.configure.bind(plugin);
export type { AgentConfigResult };

import { createRequire } from "module";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import {
  BaseAgentPlugin,
  ANTIGRAVITY_VENDOR_CONFIG,
} from "@vivantel/virage-agent-core";
import type {
  AgentConfigResult,
  AgentHooksConfig,
} from "@vivantel/virage-agent-core";
import { translateToAntigravity, writeAntigravityHooks } from "./config.js";

export class AntigravityAgentPlugin extends BaseAgentPlugin {
  readonly name = "antigravity";
  readonly label = "Google Antigravity";
  readonly vendorConfig = ANTIGRAVITY_VENDOR_CONFIG;

  async configure(
    targetDir: string = process.cwd(),
  ): Promise<AgentConfigResult> {
    const hooksConfig = await this.readHooksConfig();
    if (!hooksConfig) return { hooksWritten: false };

    const antigravityConfig = translateToAntigravity(hooksConfig);
    const hooksWritten = await writeAntigravityHooks(
      antigravityConfig,
      targetDir,
    );

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

const plugin = new AntigravityAgentPlugin();
export const configure = plugin.configure.bind(plugin);
export type { AgentConfigResult };

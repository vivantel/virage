import { createRequire } from "module";
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, relative } from "path";
import type { NormalizedEventName } from "../types/events.js";
import type { AgentConfigResult } from "../types/result.js";
import type { VendorConfig, VendorName } from "../types/vendor.js";

export abstract class BaseAgentPlugin {
  abstract readonly name: string;
  abstract readonly label: string;
  abstract readonly vendorConfig: VendorConfig;

  get vendor(): VendorName {
    return this.vendorConfig.vendor;
  }

  getVendorEventName(event: NormalizedEventName): string | string[] | null {
    return this.vendorConfig.eventNameMap[event] ?? null;
  }

  getPrimaryEventName(event: NormalizedEventName): string | null {
    const mapped = this.getVendorEventName(event);
    if (mapped == null) return null;
    return Array.isArray(mapped) ? mapped[0] : mapped;
  }

  supportsEvent(event: NormalizedEventName): boolean {
    return (
      this.vendorConfig.supportedEvents as ReadonlyArray<NormalizedEventName>
    ).includes(event);
  }

  protected resolveSkillsPackagePath(): string | null {
    try {
      const req = createRequire(import.meta.url);
      return dirname(req.resolve("@vivantel/virage-skills/package.json"));
    } catch {
      return null;
    }
  }

  private resolvePluginConfigDir(): string | null {
    try {
      const req = createRequire(import.meta.url);
      const pkgJsonPath = req.resolve(
        `${this.vendorConfig.packageName}/package.json`,
      );
      return join(dirname(pkgJsonPath), this.vendorConfig.pluginConfigDir);
    } catch {
      return null;
    }
  }

  async configure(targetDir = process.cwd()): Promise<AgentConfigResult> {
    const pluginConfigDir = this.resolvePluginConfigDir();
    if (!pluginConfigDir || !existsSync(pluginConfigDir)) {
      return { hooksWritten: false, configFilesWritten: [] };
    }

    const destDir = join(targetDir, this.vendorConfig.projectConfigDir);
    const written = await copyDirAll(pluginConfigDir, destDir);

    return { hooksWritten: written.length > 0, configFilesWritten: written };
  }
}

async function copyDirAll(src: string, dest: string): Promise<string[]> {
  const written: string[] = [];
  await copyDirRecursive(src, dest, src, written);
  return written;
}

async function copyDirRecursive(
  src: string,
  dest: string,
  root: string,
  written: string[],
): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath, root, written);
    } else if (entry.isFile()) {
      const srcContent = await readFile(srcPath);
      let destContent: Buffer | null = null;
      try {
        destContent = await readFile(destPath);
      } catch {
        // dest doesn't exist yet
      }
      if (!destContent || !srcContent.equals(destContent)) {
        await writeFile(destPath, srcContent);
        written.push(relative(root, srcPath));
      }
    }
  }
}

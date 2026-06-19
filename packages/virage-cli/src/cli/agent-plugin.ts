import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

export interface AgentPluginMeta {
  name: string;
  label: string;
  packageName: string;
  configurePath: string;
}

export interface AgentConfigResult {
  hooksWritten: boolean;
  mcpRegistered?: boolean;
}

interface AgentPluginField {
  name?: unknown;
  label?: unknown;
  configure?: unknown;
}

async function tryReadPlugin(
  depPkgDir: string,
  depName: string,
): Promise<AgentPluginMeta | null> {
  try {
    const depContent = await readFile(join(depPkgDir, "package.json"), "utf-8");
    const depPkg = JSON.parse(depContent) as Record<string, unknown>;

    const agentField = depPkg["virage-agent"];
    if (
      !agentField ||
      typeof agentField !== "object" ||
      Array.isArray(agentField)
    )
      return null;

    const field = agentField as AgentPluginField;
    if (
      typeof field.name !== "string" ||
      typeof field.label !== "string" ||
      typeof field.configure !== "string"
    )
      return null;

    const configurePath = resolve(depPkgDir, field.configure);
    if (!existsSync(configurePath)) return null;

    return {
      name: field.name,
      label: field.label,
      packageName: depName,
      configurePath,
    };
  } catch {
    return null;
  }
}

async function scanNodeModulesForAgentPlugins(
  nodeModulesDir: string,
  seen: Set<string>,
): Promise<AgentPluginMeta[]> {
  const plugins: AgentPluginMeta[] = [];

  async function scanDir(dir: string, scope?: string) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const name = scope ? `${scope}/${entry.name}` : entry.name;
        if (name.startsWith("@") && !scope) {
          await scanDir(join(dir, entry.name), entry.name);
          continue;
        }
        if (seen.has(name)) continue;
        seen.add(name);
        const plugin = await tryReadPlugin(join(dir, entry.name), name);
        if (plugin) plugins.push(plugin);
      }
    } catch {
      // dir may not exist
    }
  }

  await scanDir(nodeModulesDir);
  return plugins;
}

export async function discoverAgentPlugins(
  projectRoot: string,
): Promise<AgentPluginMeta[]> {
  // Local plugin dir wins, then global plugin dir, then node_modules (backwards compat)
  const localPluginModules = join(
    projectRoot,
    ".virage",
    "plugins",
    "node_modules",
  );
  const globalPluginModules = join(
    homedir(),
    ".virage",
    "plugins",
    "node_modules",
  );
  const nodeModulesDir = join(projectRoot, "node_modules");

  const [local, global_, compat] = await Promise.all([
    scanNodeModulesForAgentPlugins(localPluginModules, new Set()),
    scanNodeModulesForAgentPlugins(globalPluginModules, new Set()),
    scanNodeModulesForAgentPlugins(nodeModulesDir, new Set()),
  ]);

  // Merge: local wins over global wins over node_modules, dedup by name
  const byName = new Map<string, AgentPluginMeta>();
  for (const p of compat) byName.set(p.name, p);
  for (const p of global_) byName.set(p.name, p);
  for (const p of local) byName.set(p.name, p);
  return Array.from(byName.values());
}

export async function runAgentPlugin(
  meta: AgentPluginMeta,
  targetDir: string,
): Promise<AgentConfigResult> {
  const mod = (await import(meta.configurePath)) as {
    configure?: (dir: string) => Promise<AgentConfigResult>;
    default?: { configure?: (dir: string) => Promise<AgentConfigResult> };
  };

  const configureFn = mod.configure ?? mod.default?.configure;
  if (typeof configureFn !== "function") {
    throw new Error(
      `Agent plugin ${meta.packageName} does not export a configure function`,
    );
  }

  return configureFn(targetDir);
}

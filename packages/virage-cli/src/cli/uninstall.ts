import { existsSync } from "fs";
import { rm } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { confirm } from "@inquirer/prompts";
import { createOut } from "../output.js";
import { runInstallHooks } from "./install-hooks.js";
import { getLocalPluginDir, getGlobalPluginDir } from "./pkg-manager.js";

const execFileAsync = promisify(execFile);
const isWin = process.platform === "win32";
const npmBin = isWin ? "npm.cmd" : "npm";

export interface UninstallOptions {
  yes?: boolean;
  config?: string;
  verbosity?: number;
}

async function ask(message: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  return confirm({ message, default: false });
}

async function removeDir(
  path: string,
  label: string,
  out: ReturnType<typeof createOut>,
): Promise<void> {
  if (!existsSync(path)) {
    out.dim(`  ${label}: not found, skipping`);
    return;
  }
  await rm(path, { recursive: true, force: true });
  out.success(`  ${label}: removed`);
}

export async function runUninstall(opts: UninstallOptions = {}): Promise<void> {
  const out = createOut(opts.verbosity ?? 0);
  const cwd = process.cwd();
  const configPath = opts.config ?? join(cwd, "virage.config.json");
  const yes = opts.yes ?? false;

  out.section("Virage Uninstall");
  out.warn(
    "This will remove virage artefacts from this project and your system.",
  );

  // ── 1. Git hooks ─────────────────────────────────────────────────────────────
  const hooksDir = join(cwd, ".git", "hooks");
  if (existsSync(hooksDir)) {
    const doHooks = await ask("Remove virage git hooks?", yes);
    if (doHooks) {
      await runInstallHooks({ uninstall: true, verbosity: opts.verbosity });
    }
  }

  // ── 2. Local plugin directory ─────────────────────────────────────────────────
  const localPluginDir = getLocalPluginDir(cwd);
  if (existsSync(localPluginDir)) {
    const doLocal = await ask(
      `Remove local plugin directory (${localPluginDir})?`,
      yes,
    );
    if (doLocal) {
      out.dim("Removing local plugins...");
      await removeDir(localPluginDir, "local plugins", out);
    }
  }

  // ── 3. Global plugin directory ────────────────────────────────────────────────
  const globalPluginDir = getGlobalPluginDir();
  if (existsSync(globalPluginDir)) {
    const doGlobal = await ask(
      `Remove global plugin directory (${globalPluginDir})?`,
      yes,
    );
    if (doGlobal) {
      out.dim("Removing global plugins...");
      await removeDir(globalPluginDir, "global plugins", out);
    }
  }

  // ── 4. Embeddings DB (.virage/ directory) ─────────────────────────────────────
  const virageDir = join(cwd, ".virage");
  if (existsSync(virageDir)) {
    const doDb = await ask(`Remove embeddings database (${virageDir})?`, yes);
    if (doDb) {
      out.dim("Removing embeddings database...");
      await removeDir(virageDir, ".virage", out);
    }
  }

  // ── 5. Config file ────────────────────────────────────────────────────────────
  if (existsSync(configPath)) {
    const doConfig = await ask(`Remove config file (${configPath})?`, yes);
    if (doConfig) {
      await rm(configPath, { force: true });
      out.success(`  ${configPath}: removed`);
    }
  }

  // ── 6. Uninstall global CLI ───────────────────────────────────────────────────
  let isGloballyInstalled = false;
  try {
    const { stdout } = await execFileAsync(
      npmBin,
      ["list", "-g", "--depth=0", "--json"],
      { timeout: 10_000, shell: isWin },
    );
    const listed = JSON.parse(stdout) as {
      dependencies?: Record<string, unknown>;
    };
    isGloballyInstalled = "@vivantel/virage-cli" in (listed.dependencies ?? {});
  } catch {
    // Best-effort check
  }

  if (isGloballyInstalled) {
    out.warn(
      "\nThe next step will uninstall @vivantel/virage-cli globally.\n" +
        "  This removes the `virage` binary — you cannot run virage commands after this.",
    );
    const doCli = await ask("Uninstall virage CLI globally?", yes);
    if (doCli) {
      out.dim("Uninstalling @vivantel/virage-cli...");
      try {
        await execFileAsync(
          npmBin,
          ["uninstall", "-g", "@vivantel/virage-cli"],
          { shell: isWin },
        );
        out.success("  @vivantel/virage-cli: uninstalled");
      } catch (err) {
        out.error(
          `  Failed to uninstall CLI: ${err instanceof Error ? err.message : String(err)}`,
        );
        out.dim("  Try manually: npm uninstall -g @vivantel/virage-cli");
      }
    }
  }

  out.success("\nUninstall complete.");
}

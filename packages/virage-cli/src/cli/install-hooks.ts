import { existsSync } from "fs";
import { readFile, writeFile, unlink, chmod } from "fs/promises";
import { join } from "path";
import { createOut } from "../output.js";

const HOOKS = ["post-merge", "post-checkout"] as const;

const HOOK_BODY = `#!/bin/sh
# Added by virage install-hooks
npx virage index
`;

const VIRAGE_MARKER = "# Added by virage install-hooks";

export interface InstallHooksOptions {
  uninstall?: boolean;
  gitDir?: string;
  verbosity?: number;
}

function findGitHooksDir(opts: InstallHooksOptions): string {
  const base = opts.gitDir ?? join(process.cwd(), ".git");
  return join(base, "hooks");
}

async function installHook(
  hooksDir: string,
  name: string,
): Promise<"installed" | "updated" | "skipped"> {
  const hookPath = join(hooksDir, name);

  if (existsSync(hookPath)) {
    const existing = await readFile(hookPath, "utf-8");
    if (existing.includes(VIRAGE_MARKER)) return "skipped";
    const updated = existing.trimEnd() + "\n\n" + HOOK_BODY;
    await writeFile(hookPath, updated, "utf-8");
    return "updated";
  }

  await writeFile(hookPath, HOOK_BODY, "utf-8");
  await chmod(hookPath, 0o755);
  return "installed";
}

async function uninstallHook(
  hooksDir: string,
  name: string,
): Promise<"removed" | "cleaned" | "skipped"> {
  const hookPath = join(hooksDir, name);
  if (!existsSync(hookPath)) return "skipped";

  const content = await readFile(hookPath, "utf-8");
  if (!content.includes(VIRAGE_MARKER)) return "skipped";

  const without = content
    .split("\n\n")
    .filter((block) => !block.includes(VIRAGE_MARKER))
    .join("\n\n")
    .trimEnd();

  if (without === "#!/bin/sh" || without.trim() === "") {
    await unlink(hookPath);
    return "removed";
  }

  await writeFile(hookPath, without + "\n", "utf-8");
  return "cleaned";
}

export async function runInstallHooks(
  opts: InstallHooksOptions,
): Promise<void> {
  const out = createOut(opts.verbosity ?? 0);
  const hooksDir = findGitHooksDir(opts);

  if (!existsSync(hooksDir)) {
    out.error(`Git hooks directory not found: ${hooksDir}`);
    out.error("   Run this command from the root of a git repository.");
    process.exit(1);
  }

  if (opts.uninstall) {
    out.section("Removing Virage git hooks");
    for (const hook of HOOKS) {
      const result = await uninstallHook(hooksDir, hook);
      if (result === "skipped") {
        out.dim(`  ${hook}: skipped`);
      } else if (result === "removed") {
        out.success(`  ${hook}: removed`);
      } else {
        out.success(`  ${hook}: cleaned`);
      }
    }
    out.success("Done.");
    return;
  }

  out.section("Installing Virage git hooks");
  for (const hook of HOOKS) {
    const result = await installHook(hooksDir, hook);
    if (result === "skipped") {
      out.dim(`  ${hook}: already present`);
    } else {
      out.success(`  ${hook}: ${result}`);
    }
  }

  out.success(
    "Hooks installed! Virage will auto-index after git pull and branch switches.",
  );
  out.dim("   To remove: virage install-hooks --uninstall");
}

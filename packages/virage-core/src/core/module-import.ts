import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

type ErrWithCode = Error & { code?: string };

function isModuleNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as ErrWithCode).code;
  return (
    code === "MODULE_NOT_FOUND" ||
    code === "ERR_MODULE_NOT_FOUND" ||
    err.message.includes("Cannot find module") ||
    err.message.includes("Cannot find package")
  );
}

let _globalNpmRoot: string | undefined;

function globalNpmRoot(): string | undefined {
  if (_globalNpmRoot !== undefined) return _globalNpmRoot || undefined;
  try {
    _globalNpmRoot = execFileSync("npm", ["root", "-g"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    _globalNpmRoot = "";
  }
  return _globalNpmRoot || undefined;
}

async function tryImportFrom(pkg: string, base: string): Promise<unknown> {
  // createRequire resolves from the directory of the given path; '__sentinel__'
  // is a dummy filename that places the resolver in `base`.
  const req = createRequire(pathToFileURL(join(base, "__sentinel__")));
  const resolved = req.resolve(pkg);
  return import(pathToFileURL(resolved).href);
}

/**
 * Dynamic import with fallback to plugin dirs, project root, and global npm.
 * Load priority: standard → local plugin dir → global plugin dir → project root → global npm.
 */
export async function importPackage(pkg: string): Promise<unknown> {
  // 1. Standard import — works when the package is co-located with the CLI
  try {
    return await import(pkg);
  } catch (err) {
    if (!isModuleNotFound(err)) throw err;
  }

  // 2. Local plugin dir — virage init installs here by default
  try {
    return await tryImportFrom(pkg, join(process.cwd(), ".virage", "plugins"));
  } catch {
    // continue
  }

  // 3. Global plugin dir — virage init global install
  try {
    return await tryImportFrom(pkg, join(homedir(), ".virage", "plugins"));
  } catch {
    // continue
  }

  // 4. Resolve from the user's project root — backwards compat for node_modules installs
  try {
    return await tryImportFrom(pkg, process.cwd());
  } catch {
    // continue
  }

  // 5. Resolve from global npm — backwards compat for `npm install -g` installs
  const root = globalNpmRoot();
  if (root) {
    try {
      return await tryImportFrom(pkg, root);
    } catch {
      // continue
    }
  }

  throw new Error(`Cannot find module '${pkg}'`);
}

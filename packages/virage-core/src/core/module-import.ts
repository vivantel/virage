import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { getVirageDir } from "./virage-defaults.js";

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

// ESM-only packages (virage plugins) cannot be resolved with require.resolve
// because they have no "require" export condition. Read the package.json directly
// and construct the file URL from the "import" export condition.
function resolvePluginEntryPath(pkg: string, pluginDir: string): string {
  const pkgDir = join(pluginDir, "node_modules", ...pkg.split("/"));
  let pkgJson: {
    exports?: unknown;
    main?: string;
    module?: string;
  };
  try {
    pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"));
  } catch {
    throw new Error(`Package ${pkg} not found in ${pluginDir}`);
  }

  const exp =
    pkgJson.exports !== null && typeof pkgJson.exports === "object"
      ? (pkgJson.exports as Record<string, unknown>)["."]
      : pkgJson.exports;

  let entryRel: string | undefined;
  if (typeof exp === "string") {
    entryRel = exp;
  } else if (exp !== null && typeof exp === "object") {
    const o = exp as Record<string, unknown>;
    entryRel = (o["import"] ?? o["default"]) as string | undefined;
  }

  entryRel = entryRel ?? pkgJson.module ?? pkgJson.main;
  if (!entryRel)
    throw new Error(`No entry point found for ${pkg} in ${pluginDir}`);
  return join(pkgDir, entryRel);
}

async function tryImportFromPluginDir(
  pkg: string,
  pluginDir: string,
): Promise<unknown> {
  const entryPath = resolvePluginEntryPath(pkg, pluginDir);
  return import(pathToFileURL(entryPath).href);
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

  // 2. Local plugin dir — virage init installs here by default.
  //    Uses getVirageDir() so VIRAGE_DIR env-var can override the base dir
  //    (used by the eval suite runner for plugin version isolation).
  try {
    return await tryImportFromPluginDir(
      pkg,
      resolve(process.cwd(), getVirageDir(), "plugins"),
    );
  } catch {
    // continue
  }

  // 3. Global plugin dir — virage init global install
  try {
    return await tryImportFromPluginDir(
      pkg,
      join(homedir(), ".virage", "plugins"),
    );
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

import { createRequire } from "module";
import { isConformanceMode, writeDeclaration } from "@vivantel/virage-core";
import type { createOut } from "../output.js";

function cliVersion(): string {
  const require = createRequire(import.meta.url);
  // Resolves to this package's package.json from both src/cli and dist/cli.
  return (require("../../package.json") as { version: string }).version;
}

/**
 * Retrieval contract v0: in conformance mode, write (or refresh) the
 * declaration file. Does nothing otherwise. Never throws.
 */
export async function syncRetrievalDeclaration(
  projectDir: string,
  out: ReturnType<typeof createOut>,
  configPath?: string,
): Promise<void> {
  try {
    if (!(await isConformanceMode(projectDir, configPath))) return;
    const changed = await writeDeclaration(projectDir, cliVersion());
    out.dim(
      changed
        ? "Retrieval declaration written (.go-getter/retrieval/virage.json)"
        : "Retrieval declaration is current",
    );
  } catch (err) {
    out.warn(
      `Could not write retrieval declaration: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

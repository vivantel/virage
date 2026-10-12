import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

/**
 * Retrieval contract v0 — the project-side files a host tool and a retrieval
 * tool exchange. Nothing here is specific to a single host: the paths and
 * field names come from the contract itself.
 */

/** The integer version this build meets. */
export const RETRIEVAL_CONTRACT_VERSION = 0;

/** Project-relative POSIX paths (the contract fixes them). */
export const RETRIEVAL_POLICY_PATH = ".go-getter/retrieval/policy.json";
export const RETRIEVAL_DECLARATION_DIR = ".go-getter/retrieval";

/** Tool id used in the declaration and endpoint file names. */
export const RETRIEVAL_TOOL_ID = "virage";

/**
 * True only if every file is scanned for secrets before it is indexed and files
 * with findings are skipped. Keep in step with the indexing pipeline.
 */
export const PRE_INDEX_SECRET_SCAN = false;

export interface RetrievalDeclaration {
  contractVersion: number;
  tool: string;
  toolVersion: string;
  preIndexSecretScan: boolean;
  registersHostConfig: boolean;
}

export function declarationPath(
  projectDir: string,
  tool: string = RETRIEVAL_TOOL_ID,
): string {
  return join(projectDir, RETRIEVAL_DECLARATION_DIR, `${tool}.json`);
}

export function policyPath(projectDir: string): string {
  return join(projectDir, RETRIEVAL_POLICY_PATH);
}

/**
 * Whether conformance mode is on for a project.
 *
 * An explicit boolean `retrieval.conformance` in the config wins either way.
 * When it is absent, the mode is on if the host has written a policy file.
 */
export async function isConformanceMode(
  projectDir: string,
  configPath: string = join(projectDir, "virage.config.json"),
): Promise<boolean> {
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(await readFile(configPath, "utf-8")) as {
        retrieval?: { conformance?: unknown };
      };
      const flag = cfg.retrieval?.conformance;
      if (typeof flag === "boolean") return flag;
    } catch {
      // Unparseable config: fall through to policy-file detection.
    }
  }
  return existsSync(policyPath(projectDir));
}

export function buildDeclaration(toolVersion: string): RetrievalDeclaration {
  return {
    contractVersion: RETRIEVAL_CONTRACT_VERSION,
    tool: RETRIEVAL_TOOL_ID,
    toolVersion,
    preIndexSecretScan: PRE_INDEX_SECRET_SCAN,
    registersHostConfig: false,
  };
}

/**
 * Write the declaration file. Idempotent: returns false when the file already
 * has the same content.
 */
export async function writeDeclaration(
  projectDir: string,
  toolVersion: string,
): Promise<boolean> {
  const path = declarationPath(projectDir);
  const content = JSON.stringify(buildDeclaration(toolVersion), null, 2) + "\n";
  try {
    if ((await readFile(path, "utf-8")) === content) return false;
  } catch {
    // Not written yet.
  }
  await mkdir(join(projectDir, RETRIEVAL_DECLARATION_DIR), { recursive: true });
  await writeFile(path, content);
  return true;
}

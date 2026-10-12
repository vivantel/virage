import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { minimatch } from "minimatch";
import { ConfigError } from "./core/errors.js";
import {
  RETRIEVAL_CONTRACT_VERSION,
  RETRIEVAL_POLICY_PATH,
  isConformanceMode,
  policyPath,
} from "./retrieval-contract.js";

/**
 * Index policy (retrieval contract v0, part a): `.go-getter/retrieval/policy.json`.
 *
 * Owned by the host; read before every index run and every query. Mirrors
 * `crates/virage-engine/src/retrieval/policy.rs`. Errors name a path or an
 * embedder kind, never file contents.
 */

export type EmbedderKind = "local" | "hosted";

const LOCAL_EMBEDDERS = [
  "embedder-onnx",
  "embedder-fastembed",
  "embedder-transformers",
  "embedder-dylib",
];

const DATA_CLASSES = ["public", "internal", "confidential", "restricted"];

/** Only packages known to run on this machine are local; anything else is hosted (fail closed). */
export function embedderKind(pkg: string): EmbedderKind {
  return LOCAL_EMBEDDERS.some((k) => pkg.includes(k)) ? "local" : "hosted";
}

export interface RetrievalPolicy {
  /** `ignore` globs converted to minimatch syntax. */
  ignoreGlobs: string[];
  allowLocal: boolean;
  allowHosted: boolean;
  dataClass: string;
}

/**
 * Convert one gitignore-syntax line to minimatch patterns matching the same
 * paths. Blank lines, comments and negations yield nothing: a negation never
 * un-ignores.
 */
export function gitignoreToGlobs(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) return [];
  const dirOnly = trimmed.endsWith("/");
  let body = trimmed.replace(/\/+$/, "");
  let anchored: boolean;
  if (body.startsWith("/")) {
    anchored = true;
    body = body.slice(1);
  } else {
    anchored = body.includes("/");
  }
  if (!body) return [];
  const base = anchored || body.startsWith("**/") ? body : `**/${body}`;
  return dirOnly ? [`${base}/**`] : [base, `${base}/**`];
}

function refuse(message: string): never {
  throw new ConfigError(message);
}

export function parsePolicy(raw: string): RetrievalPolicy {
  const path = RETRIEVAL_POLICY_PATH;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    refuse(`retrieval policy unreadable: ${path}`);
  }
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const invalid = (field: string): never =>
    refuse(`retrieval policy invalid: ${path} (field \`${field}\`)`);

  const version = o["contractVersion"];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    invalid("contractVersion");
  }
  if (version !== RETRIEVAL_CONTRACT_VERSION) {
    refuse(`retrieval policy has an unsupported contractVersion: ${path}`);
  }

  const ignore = o["ignore"];
  if (!Array.isArray(ignore) || ignore.some((e) => typeof e !== "string")) {
    invalid("ignore");
  }
  const embedders = o["embedders"];
  if (
    !Array.isArray(embedders) ||
    embedders.some((e) => typeof e !== "string")
  ) {
    invalid("embedders");
  }
  const dataClass = o["dataClass"];
  if (typeof dataClass !== "string" || !DATA_CLASSES.includes(dataClass)) {
    invalid("dataClass");
  }

  return {
    ignoreGlobs: (ignore as string[]).flatMap(gitignoreToGlobs),
    // Unknown kinds grant nothing.
    allowLocal: (embedders as string[]).includes("local"),
    allowHosted: (embedders as string[]).includes("hosted"),
    dataClass: dataClass as string,
  };
}

/** Refuse an embedder whose kind `embedders` does not list. */
export function checkEmbedder(policy: RetrievalPolicy, pkg: string): void {
  const kind = embedderKind(pkg);
  const allowed = kind === "local" ? policy.allowLocal : policy.allowHosted;
  if (!allowed) {
    refuse(
      `refused: a ${kind} embedder is not allowed by the retrieval policy (${RETRIEVAL_POLICY_PATH})`,
    );
  }
}

/**
 * Load the policy for a project.
 *
 * - file present: parse it (always enforced, whatever the mode);
 * - file absent and conformance mode: refuse (fail closed);
 * - file absent otherwise: `null`.
 */
export async function loadRetrievalPolicy(
  projectDir: string,
  configPath?: string,
): Promise<RetrievalPolicy | null> {
  const path = policyPath(projectDir);
  if (!existsSync(path)) {
    if (await isConformanceMode(projectDir, configPath)) {
      refuse(
        `retrieval policy missing: ${RETRIEVAL_POLICY_PATH} (required in conformance mode)`,
      );
    }
    return null;
  }
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return refuse(`retrieval policy unreadable: ${RETRIEVAL_POLICY_PATH}`);
  }
  return parsePolicy(raw);
}

/** Matches project-relative paths against a policy's `ignore` globs. */
export function policyMatcher(
  policy: RetrievalPolicy,
): (path: string) => boolean {
  return (path: string) => {
    let p = path.replace(/\\/g, "/");
    if (p.startsWith("./")) p = p.slice(2);
    return policy.ignoreGlobs.some((g) => minimatch(p, g, { dot: true }));
  };
}

/**
 * Drop results whose source is ignored by the policy. A result with no source
 * path cannot be checked, so it is dropped too.
 */
export function filterByPolicy<T extends { sourceFile?: string | null }>(
  results: T[],
  policy: RetrievalPolicy | null,
): T[] {
  if (!policy) return results;
  const ignored = policyMatcher(policy);
  return results.filter((r) => !!r.sourceFile && !ignored(r.sourceFile));
}

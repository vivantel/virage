import { spawnSync, execSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

// test/acceptance/helpers/ is 5 levels below monorepo root
export const MONOREPO = fileURLToPath(
  new URL("../../../../../", import.meta.url),
);
export const CLI = join(MONOREPO, "packages/virage-core/dist/bin/virage.js");
export const STORE_PKG = "@vivantel/virage-store-test";

export interface TestEnv {
  cloneDir: string;
  tmpDir: string;
  cacheDir: string;
}

export function runCLI(cwd: string, ...args: string[]) {
  return spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

export function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function buildConfig(env: TestEnv): Record<string, unknown> {
  return {
    chunkers: [
      { patterns: ["skills/*.md", "*.md"], strategy: "markdownHeaders" },
    ],
    embedder: {
      package: "@vivantel/virage-embedder-fastembed",
      config: {
        model: "fast-bge-small-en-v1.5",
        dimensions: 384,
        cacheDir: env.cacheDir,
      },
    },
    vectorStore: {
      package: STORE_PKG,
      config: { path: "./rag-test/vector-store.json" },
    },
    options: {
      batchSize: 32,
      telemetry: true,
    },
  };
}

/**
 * Create tmpDir + optional OpenHands clone + write virage.config.json.
 * Set E2E_CLONE_DIR to reuse an existing clone and skip the slow git clone.
 */
export function setupEnv(): TestEnv {
  const tmpDir = mkdtempSync(join(tmpdir(), "rag-e2e-"));
  const cacheDir = join(tmpDir, "fastembed-cache");
  const cloneDir = process.env.E2E_CLONE_DIR ?? join(tmpDir, "openhands");

  if (!process.env.E2E_CLONE_DIR) {
    execSync(
      `git clone --depth=1 git@github.com:OpenHands/OpenHands.git ${cloneDir}`,
      {
        stdio: "inherit",
      },
    );
  }

  // Clean prior test artifacts from the clone
  rmSync(join(cloneDir, "rag-test"), { recursive: true, force: true });

  writeFileSync(
    join(cloneDir, "virage.config.json"),
    JSON.stringify(buildConfig({ cloneDir, tmpDir, cacheDir }), null, 2),
  );

  return { cloneDir, tmpDir, cacheDir };
}

export function teardownEnv(env: TestEnv): void {
  if (!process.env.E2E_CLONE_DIR) {
    rmSync(env.tmpDir, { recursive: true, force: true });
  }
}
